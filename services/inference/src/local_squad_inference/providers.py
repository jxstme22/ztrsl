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

# Faster-whisper reports per-segment no_speech_prob; segments above this are
# overwhelmingly not speech (silence, clicks, fan noise) and only feed the
# hallucination patterns above.
NO_SPEECH_PROB_LIMIT = 0.6


def is_hallucination(text: str) -> bool:
    normalized = " ".join(re.sub(r"[^\w\s]", "", text).lower().split())
    return normalized in HALLUCINATION_PHRASES


def keep_asr_segment(segment: object) -> bool:
    """Drop empty, non-speech, and pure-hallucination ASR segments.

    ``segment`` is any object exposing ``text`` (whisper-style) and an
    optional ``no_speech_prob``; kept separate so it can be unit-tested
    without loading whisper.
    """
    text = str(getattr(segment, "text", "") or "").strip()
    if not text:
        return False
    no_speech_prob = float(getattr(segment, "no_speech_prob", 0.0) or 0.0)
    if no_speech_prob >= NO_SPEECH_PROB_LIMIT:
        return False
    return not is_hallucination(text)


# Maps the app's source_mode identifiers to Whisper ISO-639-1 language tokens
# used by faster-whisper's `language` parameter. Filipino ("tl") is the safest
# Latin-script decoder constraint for Tagalog/Cebuano; Chinese ("zh") covers
# Mandarin and Cantonese transcription in simplified/traditional script.
WHISPER_LANGUAGE_CODES: dict[str, str] = {
    "filipino": "tl",
    "cebuano": "tl",
    "mixed": "tl",
    "chinese": "zh",
}


def whisper_language_code(source_mode: str) -> str:
    return WHISPER_LANGUAGE_CODES.get(source_mode, "tl")


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


class NemoCtcProvider:
    """NVIDIA NeMo CTC ASR (NCSpeech Tagalog, Citrinet-1024 Mandarin) via sherpa-onnx.

    The runtime consumes the CTC ONNX export produced by
    ``scripts/export_ncspeech_onnx.py``; ``sherpa-onnx`` does the decoding.
    The artifact id is read from the verified manifest.
    """

    def __init__(self, model_dir: Path, num_threads: int = 4) -> None:
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


class FasterWhisperProvider:

    def __init__(self, model_dir: Path, *, model_id: str | None = None) -> None:
        manifest = verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            faster_whisper = importlib.import_module("faster_whisper")
            ctranslate2 = importlib.import_module("ctranslate2")
        except ImportError as error:
            raise ModelUnavailableError(
                "faster-whisper and CTranslate2 are required for quality local ASR"
            ) from error

        configured_device = os.environ.get("LST_WHISPER_DEVICE")
        if configured_device:
            device = configured_device
        elif platform.system() == "Windows" and ctranslate2.get_cuda_device_count() > 0:
            device = "cuda"
        else:
            device = "cpu"
        compute_type = os.environ.get(
            "LST_WHISPER_COMPUTE_TYPE",
            "float16" if device == "cuda" else "int8",
        )
        try:
            self._model: Any = faster_whisper.WhisperModel(
                str(model_dir.resolve()),
                device=device,
                compute_type=compute_type,
                cpu_threads=max(1, int(os.environ.get("LST_WHISPER_CPU_THREADS", "4"))),
                num_workers=1,
            )
        except (OSError, RuntimeError, ValueError) as error:
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
            self._process = subprocess.Popen(
                [str(self._runner), str(self._model_dir.resolve())],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
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
    TARGET_LANG = "eng_Latn"
    MAX_SOURCE_CHARS = 2000

    # NLLB-200 source language tokens per app source_mode. Mandarin is
    # injected as simplified-script `zho_Hans` (AISHELL-2 transcripts are
    # simplified); the Latin-script tokens cover Tagalog/Cebuano.
    SOURCE_LANGS: ClassVar[dict[str, str]] = {
        "filipino": "tgl_Latn",
        "cebuano": "tgl_Latn",
        "mixed": "tgl_Latn",
        "chinese": "zho_Hans",
    }

    def __init__(self, model_dir: Path) -> None:
        verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            ctranslate2 = importlib.import_module("ctranslate2")
            tokenizers = importlib.import_module("tokenizers")
        except ImportError as error:
            raise ModelUnavailableError(
                "ctranslate2 and tokenizers are required for local translation"
            ) from error
        configured_device = os.environ.get("LST_TRANSLATION_DEVICE")
        if configured_device:
            device = configured_device
        elif platform.system() == "Windows" and ctranslate2.get_cuda_device_count() > 0:
            device = "cuda"
        else:
            device = "cpu"
        compute_type = os.environ.get("LST_TRANSLATION_COMPUTE_TYPE", "int8")
        try:
            self._translator: Any = ctranslate2.Translator(
                str(model_dir.resolve()),
                device=device,
                compute_type=compute_type,
            )
        except (OSError, RuntimeError, ValueError) as error:
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
                target_prefix=[[self.TARGET_LANG]],
                max_batch_size=1,
            )
        except (OSError, RuntimeError, ValueError) as error:
            raise ModelUnavailableError("NLLB translation failed") from error
        elapsed_ms = (time.perf_counter() - started) * 1_000
        hypothesis = outputs[0].hypotheses[0]
        if hypothesis and hypothesis[0] == self.TARGET_LANG:
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
