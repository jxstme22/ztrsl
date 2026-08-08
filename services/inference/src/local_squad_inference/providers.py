from __future__ import annotations

import contextlib
import hashlib
import importlib
import json
import math
import os
import platform
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar, Protocol, cast

from local_squad_inference.vad import AudioUtterance


def _register_cuda_dll_directory() -> None:
    """Add the optional CUDA runtime pack dir to the Windows DLL search path.

    ctranslate2/faster-whisper require cuBLAS/cuDNN/cudart at load time, but the
    packaged wheels do not bundle them. The app downloads a pinned, verified
    runtime pack on demand and points `LST_CUDA_LIBS_DIR` at the flattened DLL
    directory. Calling `os.add_dll_directory` here (before any ctranslate2
    import) lets Windows resolve those libraries without a system CUDA install.

    We ALSO prepend the dir to `PATH`: in a PyInstaller-frozen sidecar the
    standard DLL search can miss `add_dll_directory` entries for DLLs loaded by
    a second extension module (ctranslate2's `_ext.pyd`), while a PATH entry is
    honored everywhere. Both are additive and idempotent.
    """
    cuda_libs = os.environ.get("LST_CUDA_LIBS_DIR")
    if not cuda_libs:
        return
    if not Path(cuda_libs).is_dir():
        return
    if os.name != "nt":
        return
    with contextlib.suppress(OSError):
        os.add_dll_directory(cuda_libs)  # type: ignore[attr-defined]
    current = os.environ.get("PATH", "")
    entries = current.split(os.pathsep) if current else []
    if cuda_libs not in entries:
        os.environ["PATH"] = cuda_libs + os.pathsep + current


# Register the optional CUDA runtime pack before anything imports ctranslate2,
# so Windows can resolve cuBLAS/cuDNN/cudart when the GPU path is used.
_register_cuda_dll_directory()


class ModelUnavailableError(RuntimeError):
    pass


# Whisper sometimes "hears" boilerplate outro/announcer phrases in loud
# non-speech audio (game music, menu SFX, launch sounds) even when the VAD
# triggered on noise. These are near-universal hallucinations; a segment whose
# text reduces to exactly one of these phrases is dropped instead of being
# shown as a caption. Real speech is never an exact match in isolation.
HALLUCINATION_PHRASES: frozenset[str] = frozenset(
    {
        "thanks for watching",
        "thank you for watching",
        "thanks for listening",
        "thank you",
        "thank you so much",
        "please subscribe",
        "please like and subscribe",
        "like and subscribe",
        "subscribe for more",
        "get into the game",
        "get in the game",
    }
)

# Faster-whisper reports per-segment no_speech_prob; a high value alone is
# NOT enough to drop a segment — confident speech (strong avg_logprob) can
# legitimately score high on noisy but speechy audio. The joint decision
# drops only when BOTH no_speech_prob is high AND the logprob is poor.
# Segments without a logprob (absent field) default to "poor" so the
# conservative drop still applies.
NO_SPEECH_PROB_LIMIT = 0.6
STRONG_LOGPROB_LIMIT = -0.5


def is_hallucination(text: str) -> bool:
    normalized = " ".join(re.sub(r"[^\w\s]", "", text).lower().split())
    return normalized in HALLUCINATION_PHRASES


def keep_asr_segment(segment: object) -> bool:
    """Drop empty, non-speech, and pure-hallucination ASR segments.

    ``segment`` is any object exposing ``text`` (whisper-style) plus
    optional ``no_speech_prob``/``avg_logprob``; kept separate so it can be
    unit-tested without loading whisper. A segment is dropped when:

    - the text is empty;
    - ``no_speech_prob`` is high AND ``avg_logprob`` is poor (joint noise
      decision, DS-103) — confident speech survives;
    - the text is an exact known hallucination phrase;
    - either metric is non-finite (never trusted).
    """
    text = str(getattr(segment, "text", "") or "").strip()
    if not text:
        return False
    no_speech_prob = float(getattr(segment, "no_speech_prob", 0.0) or 0.0)
    raw_logprob = getattr(segment, "avg_logprob", None)
    avg_logprob = -1.0 if raw_logprob is None else float(raw_logprob or -1.0)
    if not math.isfinite(no_speech_prob) or not math.isfinite(avg_logprob):
        return False
    if no_speech_prob >= NO_SPEECH_PROB_LIMIT and avg_logprob < STRONG_LOGPROB_LIMIT:
        return False
    return not is_hallucination(text)


def whisper_language_code(source_mode: str) -> str:
    return WHISPER_LANGUAGE_CODES.get(source_mode, "tl")


WHISPER_LANGUAGE_CODES: dict[str, str] = {
    "filipino": "tl",
    "cebuano": "tl",
    "mixed": "tl",
    "chinese": "zh",
    "english": "en",
    "indonesian": "id",
    "vietnamese": "vi",
    "thai": "th",
    "malay": "ms",
}


@dataclass(frozen=True)
class AsrResult:
    utterance_id: str
    text: str
    source_mode: str
    is_final: bool
    inference_ms: float
    model_id: str
    confidence: float | None
    error: str | None = None
    # Detected language (Whisper ISO-639-1 token like "tl"/"en"/"zh") when
    # the provider exposes one. None means unknown; the language gate then
    # filters on confidence only (post-filter honesty). Phase 7.
    language: str | None = None


@dataclass(frozen=True)
class TranslationResult:
    utterance_id: str
    source_text: str
    english_text: str
    is_final: bool
    inference_ms: float
    model_id: str


@dataclass(frozen=True)
class FileAsrSegment:
    start_ms: int
    end_ms: int
    text: str
    inference_ms: float
    model_id: str
    confidence: float | None


class AsrProvider(Protocol):
    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult: ...


class TranslationProvider(Protocol):
    def translate(self, result: AsrResult) -> TranslationResult: ...


class FileAsrProvider(Protocol):
    def transcribe_file(self, source: Path, source_mode: str) -> tuple[FileAsrSegment, ...]: ...


class DemoAsrProvider:
    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text="[demo transcript — local ASR model not installed]",
            source_mode=source_mode,
            is_final=True,
            inference_ms=0.0,
            model_id="demo-asr",
            confidence=None,
        )


class DemoTranslationProvider:
    def translate(self, result: AsrResult) -> TranslationResult:
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text="[demo translation — local MT model not installed]",
            is_final=True,
            inference_ms=0.0,
            model_id="demo-mt",
        )


def resolve_inference_device(
    env_key: str,
    compute_env_key: str,
    *,
    cuda_compute: str,
    cpu_compute: str,
) -> tuple[str, str]:
    """Pick a decode device for ctranslate2/faster-whisper, degrading safely.

    `ctranslate2.get_cuda_device_count() > 0` only means a CUDA-capable GPU is
    visible to the driver — it does NOT guarantee the CUDA runtime libraries
    (cublas64_12.dll / cudnn64_*.dll) are installed and loadable. On a machine
    with a GPU but no CUDA runtime, choosing "cuda" makes the model load fail
    with a library-not-found error.

    We choose CUDA when a GPU is visible and let the provider's load-time
    retry-on-CPU handle the missing-runtime case: constructing a ctranslate2
    Translator *without a model path* is not a valid probe (it always raises
    TypeError), so a pre-load probe would falsely reject working CUDA installs.
    The env overrides are respected (an explicit `LST_*_DEVICE=cuda` is honored
    even if it then fails loudly).
    """
    configured = os.environ.get(env_key)
    if configured:
        compute = os.environ.get(compute_env_key)
        return configured, compute or ("float16" if configured == "cuda" else cpu_compute)
    if platform.system() == "Windows":
        try:
            ctranslate2 = importlib.import_module("ctranslate2")
            if ctranslate2.get_cuda_device_count() > 0:
                # GPU visible to the driver. The provider retries on CPU if the
                # CUDA runtime libraries are missing at model load, so we do
                # not gate on a (unreliable) pre-load probe here.
                return "cuda", cuda_compute
        except Exception:
            pass
    return "cpu", cpu_compute


def _device_was_forced(env_key: str) -> bool:
    """True when the user explicitly pinned the device via env (no fallback)."""
    return bool(os.environ.get(env_key))


def verify_manifest(model_dir: Path, manifest_path: Path) -> dict[str, object]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        artifacts = manifest["artifacts"]
    except (OSError, KeyError, json.JSONDecodeError) as error:
        raise ModelUnavailableError("model manifest is missing or invalid") from error
    if not isinstance(artifacts, list) or not artifacts:
        raise ModelUnavailableError("model manifest contains no artifacts")
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ModelUnavailableError("model manifest artifact is invalid")
        relative = artifact.get("path")
        expected = artifact.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected, str) or len(expected) != 64:
            raise ModelUnavailableError("model manifest checksum is invalid")
        target = (model_dir / relative).resolve()
        if model_dir.resolve() not in target.parents:
            raise ModelUnavailableError("model artifact escapes its model directory")
        try:
            hasher = hashlib.sha256()
            with target.open("rb") as artifact_file:
                for chunk in iter(lambda: artifact_file.read(1024 * 1024), b""):
                    hasher.update(chunk)
            digest = hasher.hexdigest()
        except OSError as error:
            raise ModelUnavailableError("model artifact is missing") from error
        if digest != expected:
            raise ModelUnavailableError("model artifact checksum failed")
    return cast(dict[str, object], manifest)


class SherpaOmnilingualProvider:
    def __init__(self, model_dir: Path, num_threads: int = 4) -> None:
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        artifacts = cast(list[dict[str, object]], manifest["artifacts"])
        paths = {
            cast(str, artifact["role"]): model_dir / cast(str, artifact["path"])
            for artifact in artifacts
        }
        try:
            sherpa = importlib.import_module("sherpa_onnx")
            numpy = importlib.import_module("numpy")
        except ImportError as error:
            raise ModelUnavailableError(
                "sherpa-onnx and numpy are required for local ASR"
            ) from error
        self._numpy: Any = numpy
        try:
            self._recognizer: Any = sherpa.OfflineRecognizer.from_omnilingual_asr_ctc(
                model=str(paths["model"]),
                tokens=str(paths["tokens"]),
                num_threads=num_threads,
                decoding_method="greedy_search",
                provider="cpu",
                debug=False,
            )
        except (KeyError, RuntimeError, TypeError) as error:
            raise ModelUnavailableError("Omnilingual ASR model could not load") from error

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        started = time.perf_counter()
        stream = self._recognizer.create_stream()
        samples = self._numpy.asarray(utterance.pcm_f32, dtype=self._numpy.float32)
        stream.accept_waveform(utterance.sample_rate, samples)
        self._recognizer.decode_stream(stream)
        text = str(stream.result.text).strip()
        elapsed_ms = (time.perf_counter() - started) * 1_000
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id="omni-ctc-300m-int8",
            confidence=None,
        )


def resolve_artifact(
    manifest: dict[str, object],
    model_dir: Path,
    role: str,
    *candidate_names: str,
) -> Path:
    """Resolve a verified manifest artifact by role or filename.

    Catalog/URL installs may or may not record roles, so lookups fall back
    to well-known filenames before giving up.
    """
    artifacts = cast(list[dict[str, object]], manifest["artifacts"])
    for artifact in artifacts:
        if artifact.get("role") == role:
            return model_dir / cast(str, artifact["path"])
    for name in candidate_names:
        candidate = model_dir / name
        if candidate.is_file():
            return candidate
    raise ModelUnavailableError(
        f"model artifact for role '{role}' is missing from the installed manifest"
    )


class StreamingParaformerProvider:
    """FunASR streaming Paraformer (Mandarin/English) via sherpa-onnx.

    The runtime consumes the ONNX export published by sherpa-onnx for the
    FunASR ``paraformer-zh-streaming`` architecture
    (``sherpa-onnx-streaming-paraformer-bilingual-zh-en``, Apache-2.0).
    Utterances are VAD-segmented by the live pipeline, so the streaming
    decoder is fed a whole segment plus tail padding and decoded to a final
    result — no chunked state is kept across utterances.
    """

    MODEL_ID = "paraformer-zh-streaming"

    def __init__(self, model_dir: Path, num_threads: int = 4) -> None:
        if not (model_dir / "manifest.json").is_file():
            raise ModelUnavailableError(
                f"FunASR Paraformer model not installed ({model_dir}). "
                "Install 'FunASR Paraformer zh (streaming)' from the Models page."
            )
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        encoder = resolve_artifact(
            manifest, model_dir, "encoder", "encoder.int8.onnx", "encoder.onnx"
        )
        decoder = resolve_artifact(
            manifest, model_dir, "decoder", "decoder.int8.onnx", "decoder.onnx"
        )
        tokens = resolve_artifact(manifest, model_dir, "tokens", "tokens.txt")
        try:
            sherpa = importlib.import_module("sherpa_onnx")
            numpy = importlib.import_module("numpy")
        except ImportError as error:
            raise ModelUnavailableError(
                "sherpa-onnx and numpy are required for local ASR"
            ) from error
        self._numpy: Any = numpy
        try:
            self._recognizer: Any = sherpa.OnlineRecognizer.from_paraformer(
                tokens=str(tokens),
                encoder=str(encoder),
                decoder=str(decoder),
                num_threads=num_threads,
                provider="cpu",
                sample_rate=16000,
                feature_dim=80,
                decoding_method="greedy_search",
            )
        except (KeyError, RuntimeError, TypeError) as error:
            raise ModelUnavailableError("Streaming Paraformer model could not load") from error

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        started = time.perf_counter()
        stream = self._recognizer.create_stream()
        samples = self._numpy.asarray(utterance.pcm_f32, dtype=self._numpy.float32)
        stream.accept_waveform(utterance.sample_rate, samples)
        tail_paddings = self._numpy.zeros(
            int(0.66 * utterance.sample_rate), dtype=self._numpy.float32
        )
        stream.accept_waveform(utterance.sample_rate, tail_paddings)
        stream.input_finished()
        while self._recognizer.is_ready(stream):
            self._recognizer.decode_stream(stream)
        text = str(self._recognizer.get_result(stream)).strip()
        elapsed_ms = (time.perf_counter() - started) * 1_000
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id=self.MODEL_ID,
            confidence=None,
        )


class NemoCtcProvider:
    """NVIDIA NeMo CTC ASR (NCSpeech Tagalog, Citrinet-1024 Mandarin) via sherpa-onnx.

    The runtime consumes the CTC ONNX export produced by
    ``scripts/export_ncspeech_onnx.py``; ``sherpa-onnx`` does the decoding.
    The artifact id is read from the verified manifest.
    """

    def __init__(self, model_dir: Path, num_threads: int = 4) -> None:
        if not (model_dir / "manifest.json").is_file():
            if "parakeet" in model_dir.name:
                variant = "zh-parakeet"
            else:
                variant = "zh" if "zh" in model_dir.name else "tl"
            raise ModelUnavailableError(
                f"NCSpeech {variant} model not installed ({model_dir}). "
                f"Run `python scripts/export_ncspeech_onnx.py --variant {variant}` "
                "to download and export it."
            )
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        self._model_id = cast(str, manifest["id"])
        artifacts = cast(list[dict[str, object]], manifest["artifacts"])
        paths = {
            cast(str, artifact["role"]): model_dir / cast(str, artifact["path"])
            for artifact in artifacts
        }
        try:
            sherpa = importlib.import_module("sherpa_onnx")
            numpy = importlib.import_module("numpy")
        except ImportError as error:
            raise ModelUnavailableError(
                "sherpa-onnx and numpy are required for local ASR"
            ) from error
        self._numpy: Any = numpy
        try:
            self._recognizer: Any = sherpa.OfflineRecognizer.from_nemo_ctc(
                model=str(paths["model"]),
                tokens=str(paths["tokens"]),
                num_threads=num_threads,
                decoding_method="greedy_search",
                provider="cpu",
                debug=False,
            )
        except (KeyError, RuntimeError, TypeError) as error:
            raise ModelUnavailableError(
                "NCSpeech CTC model could not load (exported ONNX required)"
            ) from error

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        started = time.perf_counter()
        stream = self._recognizer.create_stream()
        samples = self._numpy.asarray(utterance.pcm_f32, dtype=self._numpy.float32)
        stream.accept_waveform(utterance.sample_rate, samples)
        self._recognizer.decode_stream(stream)
        text = str(stream.result.text).strip()
        elapsed_ms = (time.perf_counter() - started) * 1_000
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id=self._model_id,
            confidence=None,
        )


class SenseVoiceProvider:
    """FunAudioLLM SenseVoiceSmall (zh/en/ja/ko/yue, auto-detect) via sherpa-onnx.

    The runtime consumes the ONNX export published by sherpa-onnx for the
    FunAudioLLM SenseVoice architecture
    (``csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17``,
    Apache-2.0, converted from ``FunAudioLLM/SenseVoiceSmall``). The model
    emits the recognized text with optional language/emotion/event tags;
    inverse text normalization is enabled so ITN-friendly transcripts
    (numbers, dates, punctuation) come back readable. The artifact id is
    read from the verified manifest.
    """

    MODEL_ID = "sensevoice-small"

    def __init__(self, model_dir: Path, num_threads: int = 4) -> None:
        if not (model_dir / "manifest.json").is_file():
            raise ModelUnavailableError(
                f"SenseVoice model not installed ({model_dir}). "
                "Install 'SenseVoice Small' from the Models page."
            )
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        self._model_id = cast(str, manifest["id"])
        model = resolve_artifact(manifest, model_dir, "model", "model.int8.onnx", "model.onnx")
        tokens = resolve_artifact(manifest, model_dir, "tokens", "tokens.txt")
        try:
            sherpa = importlib.import_module("sherpa_onnx")
            numpy = importlib.import_module("numpy")
        except ImportError as error:
            raise ModelUnavailableError(
                "sherpa-onnx and numpy are required for local ASR"
            ) from error
        self._numpy: Any = numpy
        self._model_path = str(model)
        self._tokens_path = str(tokens)
        self._num_threads = num_threads
        # DS-705: recognizers are language-specific, so cache one per
        # language. "auto" covers unknown/full-auto profiles; explicit
        # source languages force the matching recognizer.
        self._recognizers: dict[str, Any] = {}
        try:
            self._recognizers["auto"] = sherpa.OfflineRecognizer.from_sense_voice(
                model=str(model),
                tokens=str(tokens),
                num_threads=num_threads,
                language="auto",
                use_itn=True,
                decoding_method="greedy_search",
                provider="cpu",
                debug=False,
            )
        except (KeyError, RuntimeError, TypeError) as error:
            raise ModelUnavailableError(
                "SenseVoice model could not load (ONNX export required)"
            ) from error

    def _recognizer_for(self, source_mode: str) -> Any:
        """SenseVoice language for a source mode: explicit zh/en when the
        intent is known, otherwise auto (never an unrelated language)."""
        language = {"chinese": "zh", "english": "en"}.get(source_mode, "auto")
        recognizer = self._recognizers.get(language)
        if recognizer is None:
            importlib.import_module("sherpa_onnx")
            recognizer = importlib.import_module("sherpa_onnx").OfflineRecognizer.from_sense_voice(
                model=self._model_path,
                tokens=self._tokens_path,
                num_threads=self._num_threads,
                language=language,
                use_itn=True,
                decoding_method="greedy_search",
                provider="cpu",
                debug=False,
            )
            self._recognizers[language] = recognizer
        return recognizer

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        started = time.perf_counter()
        recognizer = self._recognizer_for(source_mode)
        stream = recognizer.create_stream()
        samples = self._numpy.asarray(utterance.pcm_f32, dtype=self._numpy.float32)
        stream.accept_waveform(utterance.sample_rate, samples)
        recognizer.decode_stream(stream)
        text = str(stream.result.text).strip()
        elapsed_ms = (time.perf_counter() - started) * 1_000
        # SenseVoice results expose the detected language ("zh", "en", "ja",
        # "ko", "yue"); surface it when present, otherwise stay unknown.
        language: str | None = getattr(stream.result, "lang", None) or None
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id=self._model_id,
            confidence=None,
            language=language,
        )


class FasterWhisperProvider:
    def __init__(self, model_dir: Path, *, model_id: str | None = None) -> None:
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            faster_whisper = importlib.import_module("faster_whisper")
        except ImportError as error:
            raise ModelUnavailableError(
                "faster-whisper and CTranslate2 are required for quality local ASR"
            ) from error

        device, compute_type = resolve_inference_device(
            "LST_WHISPER_DEVICE",
            "LST_WHISPER_COMPUTE_TYPE",
            cuda_compute="float16",
            cpu_compute="int8",
        )
        forced = _device_was_forced("LST_WHISPER_DEVICE")
        try:
            self._model: Any = faster_whisper.WhisperModel(
                str(model_dir.resolve()),
                device=device,
                compute_type=compute_type,
                cpu_threads=max(1, int(os.environ.get("LST_WHISPER_CPU_THREADS", "4"))),
                num_workers=1,
            )
        except (OSError, RuntimeError, ValueError) as error:
            if device == "cuda" and not forced:
                # CUDA runtime is unusable (missing cublas64_12.dll etc.) even
                # though a GPU is present. Fall back to CPU so the live session
                # starts instead of dying on a missing library.
                device, compute_type = "cpu", "int8"
                self._model = faster_whisper.WhisperModel(
                    str(model_dir.resolve()),
                    device=device,
                    compute_type=compute_type,
                    cpu_threads=max(1, int(os.environ.get("LST_WHISPER_CPU_THREADS", "4"))),
                    num_workers=1,
                )
            else:
                raise ModelUnavailableError("Whisper ASR model could not load") from error
        manifest_id = manifest.get("id")
        self._model_id = (
            model_id or (manifest_id if isinstance(manifest_id, str) else None) or model_dir.name
        )
        self._device = device
        self._compute_type = compute_type

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def runtime_detail(self) -> str:
        return f"{self._device}/{self._compute_type}"

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        try:
            numpy = importlib.import_module("numpy")
        except ImportError as error:
            raise ModelUnavailableError("numpy is required for live Whisper ASR") from error
        samples = numpy.asarray(utterance.pcm_f32, dtype=numpy.float32)
        started = time.perf_counter()
        segments, _info = self._model.transcribe(
            samples,
            language=whisper_language_code(source_mode),
            task="transcribe",
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False,
            word_timestamps=False,
            temperature=0.0,
        )
        materialized = [segment for segment in segments if keep_asr_segment(segment)]
        elapsed_ms = (time.perf_counter() - started) * 1_000
        text = " ".join(str(segment.text).strip() for segment in materialized).strip()
        confidences = [
            max(0.0, min(1.0, math.exp(float(segment.avg_logprob)))) for segment in materialized
        ]
        confidence = sum(confidences) / len(confidences) if confidences else None
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=utterance.is_final,
            inference_ms=elapsed_ms,
            model_id=self._model_id,
            confidence=confidence,
            language=_info.language if _info is not None else None,
        )

    def transcribe_file(self, source: Path, source_mode: str) -> tuple[FileAsrSegment, ...]:
        # Whisper doesn't expose a Cebuano language token. Filipino is the safest
        # Latin-script decoder constraint for the app's Tagalog/Cebuano comms scope;
        # unconstrained detection misclassifies noisy game captures as English.
        # Chinese maps to the "zh" Whisper token.
        language = whisper_language_code(source_mode)
        started = time.perf_counter()
        segments, _info = self._model.transcribe(
            str(source.resolve()),
            language=language,
            task="transcribe",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            word_timestamps=False,
        )
        materialized = [segment for segment in segments if keep_asr_segment(segment)]
        elapsed_ms = (time.perf_counter() - started) * 1_000
        per_segment_ms = elapsed_ms / max(len(materialized), 1)
        return tuple(
            FileAsrSegment(
                start_ms=max(0, round(segment.start * 1_000)),
                end_ms=max(0, round(segment.end * 1_000)),
                text=str(segment.text).strip(),
                inference_ms=per_segment_ms,
                model_id=self._model_id,
                confidence=max(0.0, min(1.0, math.exp(float(segment.avg_logprob)))),
            )
            for segment in materialized
        )


class MadladTranslationProvider:
    def __init__(self, model_dir: Path) -> None:
        verify_manifest(model_dir, model_dir / "manifest.json")
        self._model_dir = model_dir
        self._runner = Path(os.environ.get("LST_TRANSLATION_RUNNER", "translation-runner"))
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._ensure_runner()

    def _ensure_runner(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        # If a previous runner exited, start a fresh one. The previous Popen
        # handle is dropped after starting the new one to release OS pipes.
        old = self._process
        try:
            popen_kwargs: dict[str, Any] = {
                "stdin": subprocess.PIPE,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.DEVNULL,
                "text": True,
                "bufsize": 1,
            }
            if os.name == "nt":
                # Never show a console window for the MADLAD runner: it is a
                # background decode process owned by the app, and a visible
                # console makes the terminal appear to control the app.
                create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                popen_kwargs["creationflags"] = create_no_window
            self._process = subprocess.Popen(
                [str(self._runner), str(self._model_dir.resolve())],
                **popen_kwargs,
            )
        except OSError as error:
            self._process = None
            raise ModelUnavailableError("translation runner is unavailable") from error
        if self._process.stdin is None or self._process.stdout is None:
            try:
                self._process.kill()
            finally:
                self._process = None
            raise ModelUnavailableError("translation runner pipes are unavailable")
        if old is not None:
            with contextlib.suppress(subprocess.TimeoutExpired):
                old.wait(timeout=1.0)
            with contextlib.suppress(OSError):
                old.kill()

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text="",
                is_final=True,
                inference_ms=0.0,
                model_id="madlad400-3b-mt-q4",
            )
        request = json.dumps({"id": result.utterance_id, "text": result.text})
        if len(request.encode()) > 4 * 1024:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text=f"[Translation skipped, source too long: {len(result.text)} chars]",
                is_final=True,
                inference_ms=0.0,
                model_id="madlad400-3b-mt-q4",
            )
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                try:
                    self._ensure_runner()
                except ModelUnavailableError:
                    return TranslationResult(
                        utterance_id=result.utterance_id,
                        source_text=result.text,
                        english_text="[Translation unavailable — runner could not start]",
                        is_final=True,
                        inference_ms=0.0,
                        model_id="madlad400-3b-mt-q4",
                    )
            assert self._process is not None
            assert self._process.stdin is not None
            assert self._process.stdout is not None
            try:
                self._process.stdin.write(request + "\n")
                self._process.stdin.flush()
                response_line = self._process.stdout.readline()
            except (BrokenPipeError, OSError, ValueError) as error:
                try:
                    if self._process is not None:
                        self._process.kill()
                finally:
                    self._process = None
                raise ModelUnavailableError("translation runner I/O failed") from error
            if not response_line:
                try:
                    if self._process is not None:
                        self._process.kill()
                finally:
                    self._process = None
                raise ModelUnavailableError("translation runner exited unexpectedly")
        try:
            response = json.loads(response_line)
            if response["id"] != result.utterance_id:
                raise ValueError("translation response id mismatch")
            english_text = str(response["english_text"])
            inference_ms = float(response["inference_ms"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ModelUnavailableError(
                "translation runner returned an invalid response"
            ) from error
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text=english_text,
            is_final=True,
            inference_ms=inference_ms,
            model_id="madlad400-3b-mt-q4",
        )


class NllbCTranslate2Provider:
    """Near-real-time local translation via CTranslate2 + NLLB-200-distilled-600M.

    The int8 conversion loads in under a second and translates a short
    utterance in tens of milliseconds on CUDA (or ~200ms on CPU), replacing
    the MADLAD candle runner (~50s per caption) so captions land within
    about a second of speech ending.

    NLLB has no ctranslate2 ``source/target_lang_code`` arguments, so the
    language is injected manually: the source is prefixed with the source
    language token and the target language token is forced as the decoder
    prefix. The ``tokenizer.json`` (fast tokenizer) must be used instead of
    raw SentencePiece because the model expects the trailing ``</s>``.
    """

    MODEL_ID = "nllb-200-distilled-600M-ct2-int8"
    MAX_SOURCE_CHARS = 2000

    # NLLB-200 output language tokens keyed by the app's target_language.
    TARGET_LANGS: ClassVar[dict[str, str]] = {
        "en": "eng_Latn",
        "zh": "zho_Hans",
        "fil": "tgl_Latn",
        "ind": "ind_Latn",
        "vie": "vie_Latn",
        "tha": "tha_Thai",
        "zsm": "zsm_Latn",
    }

    # NLLB-200 source language tokens per app source_mode. Mandarin is
    # injected as simplified-script `zho_Hans` (AISHELL-2 transcripts are
    # simplified); the Latin-script tokens cover Tagalog/Cebuano; English
    # uses the standard `eng_Latn` token.
    SOURCE_LANGS: ClassVar[dict[str, str]] = {
        "filipino": "tgl_Latn",
        "cebuano": "tgl_Latn",
        "mixed": "tgl_Latn",
        "chinese": "zho_Hans",
        "english": "eng_Latn",
        "indonesian": "ind_Latn",
        "vietnamese": "vie_Latn",
        "thai": "tha_Thai",
        "malay": "zsm_Latn",
    }

    def __init__(self, model_dir: Path, target_language: str = "en") -> None:
        if target_language not in self.TARGET_LANGS:
            raise ValueError(f"unsupported NLLB target language: {target_language}")
        self._target_lang = self.TARGET_LANGS[target_language]
        verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            ctranslate2 = importlib.import_module("ctranslate2")
            tokenizers = importlib.import_module("tokenizers")
        except ImportError as error:
            raise ModelUnavailableError(
                "ctranslate2 and tokenizers are required for local translation"
            ) from error
        device, compute_type = resolve_inference_device(
            "LST_TRANSLATION_DEVICE",
            "LST_TRANSLATION_COMPUTE_TYPE",
            cuda_compute="int8",
            cpu_compute="int8",
        )
        forced = _device_was_forced("LST_TRANSLATION_DEVICE")
        try:
            self._translator: Any = ctranslate2.Translator(
                str(model_dir.resolve()),
                device=device,
                compute_type=compute_type,
            )
        except (OSError, RuntimeError, ValueError) as error:
            if device == "cuda" and not forced:
                # CUDA runtime is unusable (missing cublas64_12.dll etc.) even
                # though a GPU is present. Fall back to CPU so the live session
                # starts instead of dying on a missing library.
                device, compute_type = "cpu", "int8"
                self._translator = ctranslate2.Translator(
                    str(model_dir.resolve()),
                    device=device,
                    compute_type=compute_type,
                )
            else:
                raise ModelUnavailableError("NLLB translation model could not load") from error
        try:
            self._tokenizer: Any = tokenizers.Tokenizer.from_file(
                str((model_dir / "tokenizer.json").resolve())
            )
        except (OSError, ValueError) as error:
            raise ModelUnavailableError("NLLB tokenizer could not load") from error
        self._device = device
        self._compute_type = compute_type

    @property
    def runtime_detail(self) -> str:
        return f"{self._device}/{self._compute_type}"

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text="",
                is_final=True,
                inference_ms=0.0,
                model_id=self.MODEL_ID,
            )
        if len(result.text) > self.MAX_SOURCE_CHARS:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text=f"[Translation skipped, source too long: {len(result.text)} chars]",
                is_final=True,
                inference_ms=0.0,
                model_id=self.MODEL_ID,
            )
        encoding = self._tokenizer.encode(result.text)
        source_lang = self.SOURCE_LANGS.get(result.source_mode, "tgl_Latn")
        source = [source_lang, *encoding.tokens]
        started = time.perf_counter()
        try:
            outputs = self._translator.translate_batch(
                [source],
                target_prefix=[[self._target_lang]],
                max_batch_size=1,
            )
        except (OSError, RuntimeError, ValueError) as error:
            raise ModelUnavailableError("NLLB translation failed") from error
        elapsed_ms = (time.perf_counter() - started) * 1_000
        hypothesis = outputs[0].hypotheses[0]
        if hypothesis and hypothesis[0] == self._target_lang:
            hypothesis = hypothesis[1:]
        ids = [
            token_id
            for token in hypothesis
            if (token_id := self._tokenizer.token_to_id(token)) is not None
        ]
        english_text = self._tokenizer.decode(ids, skip_special_tokens=True).strip()
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text=english_text,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id=self.MODEL_ID,
        )


class OpusMtProvider:
    """Local Helsinki opus-mt translation via CTranslate2.

    Int8-quantized Marian conversions of ``Helsinki-NLP/opus-mt-*``
    (Apache-2.0, commercially usable — unlike NLLB's CC-BY-NC). Tokenization
    uses the model's SentencePiece models (``source.spm``/``target.spm``);
    CTranslate2 appends ``</s>`` to the source for Marian models. On CUDA the
    int8 weights are dequantized to float16 at load for best-quality
    inference; CPU uses int8.
    """

    MODEL_ID = "opus-mt-en-zh-ct2-int8"
    REQUIRED_SOURCE_MODE = "english"
    DIRECTION_HINT = "select 'English' source and 'Chinese' output"
    MAX_SOURCE_CHARS = 2000

    def __init__(self, model_dir: Path) -> None:
        verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            ctranslate2 = importlib.import_module("ctranslate2")
            sentencepiece = importlib.import_module("sentencepiece")
        except ImportError as error:
            raise ModelUnavailableError(
                "ctranslate2 and sentencepiece are required for opus-mt translation"
            ) from error
        device, compute_type = resolve_inference_device(
            "LST_TRANSLATION_DEVICE",
            "LST_TRANSLATION_COMPUTE_TYPE",
            cuda_compute="float16",
            cpu_compute="int8",
        )
        forced = _device_was_forced("LST_TRANSLATION_DEVICE")
        try:
            self._translator: Any = ctranslate2.Translator(
                str(model_dir.resolve()),
                device=device,
                compute_type=compute_type,
            )
        except (OSError, RuntimeError, ValueError) as error:
            if device == "cuda" and not forced:
                device, compute_type = "cpu", "int8"
                self._translator = ctranslate2.Translator(
                    str(model_dir.resolve()),
                    device=device,
                    compute_type=compute_type,
                )
            else:
                raise ModelUnavailableError("opus-mt translation model could not load") from error
        try:
            self._source_spm: Any = sentencepiece.SentencePieceProcessor(
                str((model_dir / "source.spm").resolve())
            )
            self._target_spm: Any = sentencepiece.SentencePieceProcessor(
                str((model_dir / "target.spm").resolve())
            )
        except (OSError, ValueError) as error:
            raise ModelUnavailableError("opus-mt sentencepiece model could not load") from error
        self._device = device
        self._compute_type = compute_type

    @property
    def runtime_detail(self) -> str:
        return f"{self._device}/{self._compute_type}"

    def translate(self, result: AsrResult) -> TranslationResult:
        if result.source_mode != self.REQUIRED_SOURCE_MODE:
            raise ModelUnavailableError(f"{self.MODEL_ID} translates {self.DIRECTION_HINT}")
        if not result.text:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text="",
                is_final=True,
                inference_ms=0.0,
                model_id=self.MODEL_ID,
            )
        if len(result.text) > self.MAX_SOURCE_CHARS:
            return TranslationResult(
                utterance_id=result.utterance_id,
                source_text=result.text,
                english_text=f"[Translation skipped, source too long: {len(result.text)} chars]",
                is_final=True,
                inference_ms=0.0,
                model_id=self.MODEL_ID,
            )
        source = [
            self._source_spm.id_to_piece(token_id)
            for token_id in self._source_spm.encode(result.text, out_type=int)
        ]
        started = time.perf_counter()
        try:
            outputs = self._translator.translate_batch(
                [source],
                max_batch_size=1,
                beam_size=4,
                length_penalty=0.8,
                repetition_penalty=1.3,
            )
        except (OSError, RuntimeError, ValueError) as error:
            raise ModelUnavailableError("opus-mt translation failed") from error
        elapsed_ms = (time.perf_counter() - started) * 1_000
        hypothesis = outputs[0].hypotheses[0]
        ids = [self._target_spm.piece_to_id(token) for token in hypothesis]
        target_text = self._target_spm.decode(ids).strip()
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text=target_text,
            is_final=True,
            inference_ms=elapsed_ms,
            model_id=self.MODEL_ID,
        )


class OpusMtEnZhProvider(OpusMtProvider):
    """English->Chinese Helsinki opus-mt (``opus-mt-en-zh-ct2-int8``)."""

    MODEL_ID = "opus-mt-en-zh-ct2-int8"
    REQUIRED_SOURCE_MODE = "english"
    DIRECTION_HINT = "English audio to Chinese only; select 'English' source and 'Chinese' output"


class OpusMtZhEnProvider(OpusMtProvider):
    """Chinese->English Helsinki opus-mt (``opus-mt-zh-en-ct2-int8``)."""

    MODEL_ID = "opus-mt-zh-en-ct2-int8"
    REQUIRED_SOURCE_MODE = "chinese"
    DIRECTION_HINT = "Chinese audio to English only; select 'Chinese' source and 'English' output"


def provider_readiness(model_root: Path) -> dict[str, dict[str, str | bool]]:
    artifact_root = model_root if model_root.name == "artifacts" else model_root / "artifacts"

    def verified(model_id: str) -> bool:
        directory = artifact_root / model_id
        try:
            verify_manifest(directory, directory / "manifest.json")
        except ModelUnavailableError:
            return False
        return True

    configured_asr = os.environ.get("LST_WHISPER_MODEL_ID", "whisper-large-v3")
    asr_ready = verified(configured_asr)
    turbo_ready = verified("whisper-large-v3-turbo")
    full_ready = verified("whisper-large-v3")
    ncspeech_ready = verified("ncspeech-tl-fastconformer-hybrid-large")
    ncspeech_zh_ready = verified("ncspeech-zh-citrinet-1024-gamma")
    ncspeech_zh_parakeet_ready = verified("ncspeech-zh-parakeet-ctc-0.6b")
    nllb_ready = verified("nllb-200-distilled-600M-ct2-int8")
    translation_ready = (
        verified("madlad400-3b-mt")
        and Path(os.environ.get("LST_TRANSLATION_RUNNER", "translation-runner")).is_file()
    )
    return {
        "vad": {
            "ready": True,
            "provider": "silero-vad-onnx",
            "detail": "stateful CPU speech detector bundled with faster-whisper",
        },
        "asr": {
            "ready": asr_ready,
            "provider": configured_asr,
            "detail": (
                "verified live and contextual model"
                if asr_ready
                else "verified Whisper model install required"
            ),
        },
        "asr_turbo": {
            "ready": turbo_ready,
            "provider": "whisper-large-v3-turbo",
            "detail": "verified" if turbo_ready else "not installed",
        },
        "asr_full": {
            "ready": full_ready,
            "provider": "whisper-large-v3",
            "detail": "verified" if full_ready else "not installed",
        },
        "asr_ncspeech": {
            "ready": ncspeech_ready,
            "provider": "ncspeech-tl-fastconformer-hybrid-large",
            "detail": "verified" if ncspeech_ready else "not installed",
        },
        "asr_ncspeech_zh": {
            "ready": ncspeech_zh_ready,
            "provider": "ncspeech-zh-citrinet-1024-gamma",
            "detail": "verified" if ncspeech_zh_ready else "not installed",
        },
        "asr_ncspeech_zh_parakeet": {
            "ready": ncspeech_zh_parakeet_ready,
            "provider": "ncspeech-zh-parakeet-ctc-0.6b",
            "detail": "verified" if ncspeech_zh_parakeet_ready else "not installed",
        },
        "translation_nllb": {
            "ready": nllb_ready,
            "provider": "nllb-200-distilled-600M-ct2-int8",
            "detail": "verified" if nllb_ready else "not installed (near-real-time default)",
        },
        "translation": {
            "ready": translation_ready,
            "provider": "madlad400-3b-mt-q4",
            "detail": (
                "verified local artifact and runner"
                if translation_ready
                else "verified model and runner required"
            ),
        },
        "demo": {
            "ready": True,
            "provider": "deterministic-demo",
            "detail": f"no content inference; model root: {model_root.name}",
        },
    }
