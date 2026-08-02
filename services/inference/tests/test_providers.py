import json
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
    def __init__(self, text: str, no_speech_prob: float = 0.0) -> None:
        self.text = text
        self.no_speech_prob = no_speech_prob


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


class FakeTranslator:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def translate_batch(self, source: list[list[str]], **kwargs: Any) -> list[Any]:
        self.calls.append({"source": source, **kwargs})
        return [
            SimpleNamespace(hypotheses=[["eng_Latn", "▁They", "▁are", "▁on", "▁A", "."]])
        ]


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
