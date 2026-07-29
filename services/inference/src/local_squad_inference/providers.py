from __future__ import annotations

import hashlib
import importlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from local_squad_inference.vad import AudioUtterance


class ModelUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class AsrResult:
    utterance_id: str
    text: str
    source_mode: str
    is_final: bool
    inference_ms: float
    model_id: str
    confidence: float | None


@dataclass(frozen=True)
class TranslationResult:
    utterance_id: str
    source_text: str
    english_text: str
    is_final: bool
    inference_ms: float
    model_id: str


class AsrProvider(Protocol):
    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult: ...


class TranslationProvider(Protocol):
    def translate(self, result: AsrResult) -> TranslationResult: ...


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
    return manifest


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
            feature_config = sherpa.FeatureConfig(sample_rate=16_000, feature_dim=80)
            omnilingual = sherpa.OfflineOmnilingualModelConfig(
                model=str(paths["model"])
            )
            model_config = sherpa.OfflineModelConfig(
                omnilingual=omnilingual,
                tokens=str(paths["tokens"]),
                num_threads=num_threads,
                provider="cpu",
                debug=False,
            )
            config = sherpa.OfflineRecognizerConfig(
                feat_config=feature_config,
                model_config=model_config,
                decoding_method="greedy_search",
            )
            self._recognizer: Any = sherpa.OfflineRecognizer(config)
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


class MadladTranslationProvider:
    def __init__(self, model_dir: Path) -> None:
        verify_manifest(model_dir, model_dir / "manifest.json")
        try:
            transformers = importlib.import_module("transformers")
            torch = importlib.import_module("torch")
        except ImportError as error:
            raise ModelUnavailableError(
                "transformers and torch are required for local translation"
            ) from error
        self._torch: Any = torch
        try:
            self._tokenizer: Any = transformers.AutoTokenizer.from_pretrained(
                model_dir,
                local_files_only=True,
                trust_remote_code=False,
            )
            self._model: Any = transformers.AutoModelForSeq2SeqLM.from_pretrained(
                model_dir,
                local_files_only=True,
                trust_remote_code=False,
                torch_dtype="auto",
            )
        except (OSError, RuntimeError, TypeError) as error:
            raise ModelUnavailableError("MADLAD translation model could not load") from error
        if torch.backends.mps.is_available():
            self._device = "mps"
        elif torch.cuda.is_available():
            self._device = "cuda"
        else:
            self._device = "cpu"
        self._model.to(self._device)
        self._model.eval()

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            english_text = ""
            inference_ms = 0.0
        else:
            started = time.perf_counter()
            inputs = self._tokenizer(
                f"<2en> {result.text}",
                return_tensors="pt",
                truncation=True,
                max_length=512,
            )
            inputs = {name: value.to(self._device) for name, value in inputs.items()}
            with self._torch.inference_mode():
                generated = self._model.generate(**inputs, max_new_tokens=256)
            english_text = str(
                self._tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
            ).strip()
            inference_ms = (time.perf_counter() - started) * 1_000
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text=english_text,
            is_final=True,
            inference_ms=inference_ms,
            model_id="madlad400-3b-mt",
        )


def provider_readiness(model_root: Path) -> dict[str, dict[str, str | bool]]:
    return {
        "vad": {
            "ready": False,
            "provider": "silero-vad-onnx",
            "detail": "model adapter pending verified artifact",
        },
        "asr": {
            "ready": False,
            "provider": "omnilingual-ctc-300m-int8",
            "detail": "verified model install required",
        },
        "translation": {
            "ready": False,
            "provider": "madlad400-3b-mt",
            "detail": "verified model install required",
        },
        "demo": {
            "ready": True,
            "provider": "deterministic-demo",
            "detail": f"no content inference; model root: {model_root.name}",
        },
    }
