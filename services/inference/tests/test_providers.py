import json
import platform
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest

from local_squad_inference.providers import (
    AsrResult,
    ModelUnavailableError,
    NllbCTranslate2Provider,
    is_hallucination,
    keep_asr_segment,
)


class FakeSegment:
    def __init__(
        self,
        text: str,
        no_speech_prob: float = 0.0,
        avg_logprob: float | None = None,
    ) -> None:
        self.text = text
        self.no_speech_prob = no_speech_prob
        self.avg_logprob = avg_logprob

def test_is_hallucination_matches_known_phrases() -> None:
    assert is_hallucination("Thanks for Watching!")
    assert is_hallucination("thank you")
    assert is_hallucination("GET INTO THE GAME")
    assert is_hallucination("Please like and subscribe.")
    assert is_hallucination("thanks for watching...")

    assert not is_hallucination("thanks for watching, rotate B")
    assert not is_hallucination("thank you guys, nice clutch")
    assert not is_hallucination("get into the game right now everyone")
    assert not is_hallucination("rotate to A")

def test_keep_asr_segment_drops_non_speech_and_hallucinations() -> None:
    assert keep_asr_segment(FakeSegment("rotate B, they are on A")) is True
    assert keep_asr_segment(FakeSegment("Thank you!")) is False
    assert keep_asr_segment(FakeSegment("Thanks for watching", no_speech_prob=0.9)) is False
    assert keep_asr_segment(FakeSegment("", no_speech_prob=0.0)) is False
    assert keep_asr_segment(FakeSegment("let's go", no_speech_prob=0.95)) is False
    assert keep_asr_segment(FakeSegment("push now", no_speech_prob=0.1)) is True

def test_keep_asr_segment_joint_no_speech_decision() -> None:
    # High no_speech_prob with STRONG logprob is confident speech: keep.
    assert (
        keep_asr_segment(
            FakeSegment("rotate B, they are on A", no_speech_prob=0.95, avg_logprob=-0.2)
        )
        is True
    )
    # High no_speech_prob with POOR logprob is noise: drop.
    assert keep_asr_segment(FakeSegment("let's go", no_speech_prob=0.95, avg_logprob=-1.5)) is False
    # Short high-confidence Chinese text survives.
    assert keep_asr_segment(FakeSegment("上A点", no_speech_prob=0.3, avg_logprob=-0.1)) is True
    # One-word tactical speech survives.
    assert keep_asr_segment(FakeSegment("rush", no_speech_prob=0.2, avg_logprob=-0.4)) is True
    # Normal speech with punctuation survives.
    assert (
        keep_asr_segment(
            FakeSegment("Rotate A, they're on B.", no_speech_prob=0.4, avg_logprob=-0.3)
        )
        is True
    )
    # Exact hallucination phrases are dropped even with a strong logprob.
    assert (
        keep_asr_segment(
            FakeSegment("Thank you for watching", no_speech_prob=0.1, avg_logprob=-0.2)
        )
        is False
    )
    # Non-finite metrics are never trusted.
    assert (
        keep_asr_segment(FakeSegment("hello", no_speech_prob=float("nan"), avg_logprob=-0.2))
        is False
    )
    assert (
        keep_asr_segment(FakeSegment("hello", no_speech_prob=0.2, avg_logprob=float("inf")))
        is False
    )

class FakeTranslator:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def translate_batch(self, source: list[list[str]], **kwargs: Any) -> list[Any]:
        self.calls.append({"source": source, **kwargs})
        return [SimpleNamespace(hypotheses=[["eng_Latn", "▁They", "▁are", "▁on", "▁A", "."]])]

class FakeCTranslate2Module:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.cuda_device_count = 1
        self.translator: FakeTranslator | None = None

    def get_cuda_device_count(self) -> int:
        return self.cuda_device_count

    def Translator(self, path: str, **kwargs: Any) -> FakeTranslator:
        self.created.append({"path": path, **kwargs})
        self.translator = FakeTranslator()
        return self.translator

class FakeEncoding:
    def __init__(self) -> None:
        self.tokens: list[str] = ["▁Push", "▁na"]

class FakeTokenizer:
    encodes: ClassVar[list[str]] = []

    def __init__(self) -> None:
        pass

    @classmethod
    def from_file(cls, path: str) -> "FakeTokenizer":
        return cls()

    def encode(self, text: str) -> FakeEncoding:
        self.encodes.append(text)
        return FakeEncoding()

    def token_to_id(self, token: str) -> int | None:
        mapping = {"▁They": 100, "▁are": 101, "▁on": 102, "▁A": 103, ".": 104}
        return mapping.get(token)

    def decode(self, ids: list[int], **kwargs: Any) -> str:
        reverse = {100: "They", 101: "are", 102: "on", 103: "A", 104: "."}
        return " ".join(reverse.get(i, "?") for i in ids).replace(" .", ".")

class FakeTokenizerModule:
    def __init__(self) -> None:
        self.Tokenizer = FakeTokenizer

@pytest.fixture
def nllb_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[dict[str, Any], Path]:
    model_dir = tmp_path / "nllb"
    model_dir.mkdir()
    (model_dir / "model.bin").write_bytes(b"\x00\x00\x00\x00")
    (model_dir / "tokenizer.json").write_bytes(b"\x00\x00\x00\x00")

    def digest(data: bytes) -> str:
        import hashlib

        return hashlib.sha256(data).hexdigest()

    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "nllb-200-distilled-600M-ct2-int8",
                "artifacts": [
                    {
                        "role": "model",
                        "path": "model.bin",
                        "size_bytes": 4,
                        "sha256": digest(b"\x00\x00\x00\x00"),
                    },
                    {
                        "role": "tokenizer",
                        "path": "tokenizer.json",
                        "size_bytes": 4,
                        "sha256": digest(b"\x00\x00\x00\x00"),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    ct2 = FakeCTranslate2Module()
    tok = FakeTokenizerModule()
    monkeypatch.setitem(sys.modules, "ctranslate2", ct2)
    monkeypatch.setitem(sys.modules, "tokenizers", tok)
    monkeypatch.delenv("LST_TRANSLATION_DEVICE", raising=False)
    monkeypatch.delenv("LST_TRANSLATION_COMPUTE_TYPE", raising=False)
    return {"ct2": ct2, "tok": tok}, model_dir

@pytest.mark.skipif(
    platform.system() != "Windows",
    reason="CUDA is deliberately enabled only on Windows in this codebase",
)
def test_nllb_provider_uses_cuda_when_available(nllb_env: tuple[dict[str, Any], Path]) -> None:
    modules, model_dir = nllb_env
    provider = NllbCTranslate2Provider(model_dir)
    created = modules["ct2"].created[0]
    assert created["device"] == "cuda"
    assert created["compute_type"] == "int8"
    assert provider.runtime_detail == "cuda/int8"

def test_nllb_provider_falls_back_to_cpu(nllb_env: tuple[dict[str, Any], Path]) -> None:
    modules, model_dir = nllb_env
    modules["ct2"].cuda_device_count = 0
    provider = NllbCTranslate2Provider(model_dir)
    assert modules["ct2"].created[0]["device"] == "cpu"
    assert provider.runtime_detail == "cpu/int8"

def test_nllb_provider_translate_injects_lang_tokens_and_strips_prefix(
    nllb_env: tuple[dict[str, Any], Path],
) -> None:
    modules, model_dir = nllb_env
    provider = NllbCTranslate2Provider(model_dir)
    result = provider.translate(
        AsrResult(
            utterance_id="u1",
            text="Push na",
            source_mode="filipino",
            is_final=True,
            inference_ms=5.0,
            model_id="whisper-large-v3-turbo",
            confidence=0.9,
        )
    )
    call = modules["ct2"].translator.calls[0]
    assert call["source"] == [["tgl_Latn", "▁Push", "▁na"]]
    assert call["target_prefix"] == [["eng_Latn"]]
    assert result.english_text == "They are on A."
    assert result.model_id == "nllb-200-distilled-600M-ct2-int8"
    assert modules["tok"].Tokenizer.encodes == ["Push na"]

def test_nllb_provider_injects_chinese_source_token(
    nllb_env: tuple[dict[str, Any], Path],
) -> None:
    modules, model_dir = nllb_env
    provider = NllbCTranslate2Provider(model_dir)
    provider.translate(
        AsrResult(
            utterance_id="u1",
            text="你好",
            source_mode="chinese",
            is_final=True,
            inference_ms=5.0,
            model_id="ncspeech-zh-citrinet-1024-gamma",
            confidence=None,
        )
    )
    call = modules["ct2"].translator.calls[0]
    assert call["source"] == [["zho_Hans", "▁Push", "▁na"]]
    assert call["target_prefix"] == [["eng_Latn"]]

def test_nllb_provider_english_to_chinese_target(
    nllb_env: tuple[dict[str, Any], Path],
) -> None:
    modules, model_dir = nllb_env
    provider = NllbCTranslate2Provider(model_dir, target_language="zh")
    provider.translate(
        AsrResult(
            utterance_id="u1",
            text="Push A site",
            source_mode="english",
            is_final=True,
            inference_ms=5.0,
            model_id="whisper-large-v3-turbo",
            confidence=0.9,
        )
    )
    call = modules["ct2"].translator.calls[0]
    assert call["source"] == [["eng_Latn", "▁Push", "▁na"]]
    assert call["target_prefix"] == [["zho_Hans"]]

def test_nllb_provider_rejects_unknown_target_language(
    nllb_env: tuple[dict[str, Any], Path],
) -> None:
    _, model_dir = nllb_env
    with pytest.raises(ValueError):
        NllbCTranslate2Provider(model_dir, target_language="de")

def test_nllb_provider_passthrough_empty_and_long_text(
    nllb_env: tuple[dict[str, Any], Path],
) -> None:
    modules, model_dir = nllb_env
    provider = NllbCTranslate2Provider(model_dir)
    empty = provider.translate(
        AsrResult(
            utterance_id="u1",
            text="",
            source_mode="filipino",
            is_final=True,
            inference_ms=5.0,
            model_id="m",
            confidence=None,
        )
    )
    assert empty.english_text == ""
    assert modules["ct2"].translator.calls == []
    long_text = provider.translate(
        AsrResult(
            utterance_id="u2",
            text="x" * 3000,
            source_mode="filipino",
            is_final=True,
            inference_ms=5.0,
            model_id="m",
            confidence=None,
        )
    )
    assert "too long" in long_text.english_text
    assert modules["ct2"].translator.calls == []

def test_nllb_provider_missing_manifest_is_visible(
    nllb_env: tuple[dict[str, Any], Path], tmp_path: Path
) -> None:
    _, _model_dir = nllb_env
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    with pytest.raises(ModelUnavailableError):
        NllbCTranslate2Provider(empty_dir)

class FakeSherpaSenseVoiceModule:
    """Fake `sherpa_onnx` for SenseVoice: `from_sense_voice` returns a
    recognizer wired to the module instance, recording decode calls."""

    _current: "FakeSherpaSenseVoiceModule | None" = None

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._state = {"text": "", "lang": None}
        FakeSherpaSenseVoiceModule._current = self

    def set_result(self, text: str, lang: str | None = None) -> None:
        self._state["text"] = text
        self._state["lang"] = lang

    class OfflineRecognizer:
        @classmethod
        def from_sense_voice(cls, **kwargs: Any) -> Any:
            assert FakeSherpaSenseVoiceModule._current is not None
            FakeSherpaSenseVoiceModule._current.calls.append(kwargs)
            return cls()

        def create_stream(self) -> Any:
            return SimpleNamespace(
                result=SimpleNamespace(text="", lang=None),
                accept_waveform=lambda sample_rate, samples: None,
            )

        def decode_stream(self, stream: Any) -> None:
            assert FakeSherpaSenseVoiceModule._current is not None
            FakeSherpaSenseVoiceModule._current.calls.append({"decoded": True})
            stream.result = SimpleNamespace(
                text=FakeSherpaSenseVoiceModule._current._state["text"],
                lang=FakeSherpaSenseVoiceModule._current._state["lang"],
            )


@pytest.fixture
def sensevoice_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[dict[str, Any], Path]:
    pytest.importorskip("numpy")
    model_dir = tmp_path / "sensevoice-small"
    model_dir.mkdir()
    (model_dir / "model.int8.onnx").write_bytes(b"\x00\x01\x02\x03")
    (model_dir / "tokens.txt").write_text("a\nb\n", encoding="utf-8")

    def digest(data: bytes) -> str:
        import hashlib

        return hashlib.sha256(data).hexdigest()

    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "sensevoice-small",
                "artifacts": [
                    {
                        "role": "model",
                        "path": "model.int8.onnx",
                        "size_bytes": 4,
                        "sha256": digest(b"\x00\x01\x02\x03"),
                    },
                    {
                        "role": "tokens",
                        "path": "tokens.txt",
                        "size_bytes": 4,
                        "sha256": digest(b"a\nb\n"),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    sherpa = FakeSherpaSenseVoiceModule()
    monkeypatch.setitem(sys.modules, "sherpa_onnx", sherpa)
    return {"sherpa": sherpa}, model_dir


def test_sensevoice_provider_transcribes_utterance(
    sensevoice_env: tuple[dict[str, Any], Path],
) -> None:
    from local_squad_inference.providers import SenseVoiceProvider
    from local_squad_inference.vad import AudioUtterance

    modules, model_dir = sensevoice_env
    modules["sherpa"].set_result("翻A点", lang="zh")
    provider = SenseVoiceProvider(model_dir)
    result = provider.transcribe(
        AudioUtterance(
            utterance_id="u1",
            pcm_f32=(0.0, 0.1, 0.0),
            sample_rate=16_000,
            started_ns=0,
            ended_ns=1_000_000_000,
            is_final=True,
            forced_end=True,
        ),
        source_mode="chinese",
    )
    assert result.text == "翻A点"
    assert result.language == "zh"
    assert result.model_id == "sensevoice-small"
    assert result.is_final is True
    calls = modules["sherpa"].calls
    # DS-705: an explicit Chinese source requests the "zh" recognizer.
    zh_config = next(call for call in calls if call.get("language") == "zh")
    assert zh_config["use_itn"] is True
    assert zh_config["num_threads"] == 4
    assert zh_config["provider"] == "cpu"
    assert zh_config["model"].endswith("model.int8.onnx")
    assert zh_config["tokens"].endswith("tokens.txt")
    assert calls[-1] == {"decoded": True}

def test_sensevoice_uses_auto_recognizer_for_unknown_languages(
    sensevoice_env: tuple[dict[str, Any], Path],
) -> None:
    from local_squad_inference.providers import SenseVoiceProvider
    from local_squad_inference.vad import AudioUtterance

    modules, model_dir = sensevoice_env
    modules["sherpa"].set_result("hello", lang=None)
    provider = SenseVoiceProvider(model_dir)
    result = provider.transcribe(
        AudioUtterance(
            utterance_id="u1",
            pcm_f32=(0.0, 0.1, 0.0),
            sample_rate=16_000,
            started_ns=0,
            ended_ns=1_000_000_000,
            is_final=True,
            forced_end=True,
        ),
        source_mode="filipino",
    )
    assert result.text == "hello"
    assert result.language is None
    auto_config = next(call for call in modules["sherpa"].calls if call.get("language") == "auto")
    assert auto_config is not None

def test_sensevoice_provider_missing_manifest_is_visible(tmp_path: Path) -> None:
    from local_squad_inference.providers import SenseVoiceProvider

    empty = tmp_path / "sensevoice-empty"
    empty.mkdir()
    with pytest.raises(ModelUnavailableError, match="not installed"):
        SenseVoiceProvider(empty)

def test_sensevoice_provider_missing_library_is_visible(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from local_squad_inference.providers import SenseVoiceProvider

    model_dir = tmp_path / "sensevoice-missing-lib"
    model_dir.mkdir()
    (model_dir / "model.int8.onnx").write_bytes(b"\x00")
    (model_dir / "tokens.txt").write_text("a\n", encoding="utf-8")
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "sensevoice-small",
                "artifacts": [
                    {"path": "model.int8.onnx", "size_bytes": 1, "sha256": "0" * 64},
                    {"path": "tokens.txt", "size_bytes": 2, "sha256": "1" * 64},
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.delitem(sys.modules, "sherpa_onnx", raising=False)

    def _raise_on_sherpa(name: str) -> Any:
        if name == "sherpa_onnx":
            raise ImportError("no sherpa-onnx installed")
        return __import__(name)

    monkeypatch.setattr("importlib.import_module", _raise_on_sherpa)
    with pytest.raises(ModelUnavailableError):
        SenseVoiceProvider(model_dir)
