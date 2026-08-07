import io
import math
import struct
import wave

import pytest

from local_squad_inference import http_asr
from local_squad_inference.http_asr import (
    NVIDIA_ASR_ENDPOINTS,
    GroqWhisperProvider,
    HttpAsrError,
    NvidiaAsrProvider,
    _pcm_f32_to_wav,
)
from local_squad_inference.vad import AudioUtterance


def make_utterance() -> AudioUtterance:
    samples = tuple(0.8 * math.sin(2 * math.pi * 1000 * i / 16_000) for i in range(5_120))
    return AudioUtterance(
        utterance_id="u-groq-1",
        pcm_f32=samples,
        sample_rate=16_000,
        started_ns=0,
        ended_ns=320_000_000,
        is_final=True,
        forced_end=False,
    )


def test_pcm_to_wav_produces_valid_16k_mono_wav() -> None:
    samples = (0.0, 0.5, -0.5, 1.0, -1.0)
    wav = _pcm_f32_to_wav(samples, 16_000)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert struct.unpack("<H", wav[20:22])[0] == 1  # PCM
    assert struct.unpack("<H", wav[22:24])[0] == 1  # mono
    assert struct.unpack("<I", wav[24:28])[0] == 16_000
    assert struct.unpack("<H", wav[34:36])[0] == 16  # 16-bit
    assert struct.unpack("<I", wav[40:44])[0] == 10  # 5 samples * 2 bytes
    with io.BytesIO(wav) as stream, wave.open(stream) as parsed:
        assert parsed.getframerate() == 16_000
        assert parsed.getnchannels() == 1
        assert parsed.getsampwidth() == 2


def test_groq_provider_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LST_GROQ_API_KEY", raising=False)
    with pytest.raises(HttpAsrError, match="API key"):
        GroqWhisperProvider()


def test_groq_transcribe_returns_english_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_GROQ_API_KEY", "gsk_test")
    captured: dict[str, object] = {}

    def fake_upload(
        url: str,
        *,
        wav_bytes: bytes,
        model: str,
        language: str,
        api_key: str,
        timeout_s: float,
    ) -> dict[str, object]:
        captured["model"] = model
        captured["language"] = language
        captured["api_key"] = api_key
        captured["wav_has_riif"] = wav_bytes.startswith(b"RIFF")
        captured["timeout_s"] = timeout_s
        return {"text": "How are you?"}

    monkeypatch.setattr(http_asr, "_multipart_upload", fake_upload)
    provider = GroqWhisperProvider()
    result = provider.transcribe(make_utterance(), "filipino")
    assert result.text == "How are you?"
    assert result.is_final is True
    assert result.source_mode == "filipino"
    assert captured["model"] == "whisper-large-v3-turbo"
    assert captured["language"] == "tl"
    assert captured["api_key"] == "gsk_test"
    assert captured["wav_has_riif"] is True


def test_groq_transcribe_maps_chinese_to_zh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LST_GROQ_API_KEY", "gsk_test")
    captured: dict[str, object] = {}

    def fake_upload(
        url: str,
        *,
        wav_bytes: bytes,
        model: str,
        language: str,
        api_key: str,
        timeout_s: float,
    ) -> dict[str, object]:
        captured["language"] = language
        return {"text": "你好"}

    monkeypatch.setattr(http_asr, "_multipart_upload", fake_upload)
    result = GroqWhisperProvider().transcribe(make_utterance(), "chinese")
    assert result.source_mode == "chinese"
    assert captured["language"] == "zh"
    assert result.text == "你好"


def test_groq_transcribe_failure_returns_empty_not_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_GROQ_API_KEY", "gsk_test")

    def failing_upload(
        url: str,
        *,
        wav_bytes: bytes,
        model: str,
        language: str,
        api_key: str,
        timeout_s: float,
    ) -> dict[str, object]:
        raise OSError("network down")

    monkeypatch.setattr(http_asr, "_multipart_upload", failing_upload)
    result = GroqWhisperProvider().transcribe(make_utterance(), "filipino")
    assert result.text == ""
    assert result.error == "network down"
    assert result.utterance_id == "u-groq-1"


def test_nvidia_provider_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LST_NVIDIA_API_KEY", raising=False)
    with pytest.raises(HttpAsrError):
        NvidiaAsrProvider("nvidia-whisper-large-v3")


def test_nvidia_transcribe_posts_multipart_with_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")
    captured: dict[str, object] = {}

    def fake_upload(
        url: str,
        *,
        wav_bytes: bytes,
        language: str,
        api_key: str,
        timeout_s: float,
    ) -> dict[str, object]:
        captured["url"] = url
        captured["language"] = language
        captured["api_key"] = api_key
        captured["wav_has_riif"] = wav_bytes.startswith(b"RIFF")
        return {"text": "say it"}

    monkeypatch.setattr(http_asr, "_nvidia_multipart_upload", fake_upload)
    provider = NvidiaAsrProvider("nvidia-whisper-large-v3")
    result = provider.transcribe(make_utterance(), "filipino")
    assert result.text == "say it"
    assert captured["url"] == NVIDIA_ASR_ENDPOINTS["nvidia-whisper-large-v3"].endpoint
    assert captured["language"] == "tl"
    assert captured["api_key"] == "nvapi_test"
    assert captured["wav_has_riif"] is True


def test_nvidia_parakeet_rejects_unsupported_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")
    provider = NvidiaAsrProvider("nvidia-parakeet-1.1b")
    result = provider.transcribe(make_utterance(), "filipino")
    assert result.text == ""
    assert result.error is not None
    assert "does not support" in result.error


def test_nvidia_parakeet_accepts_supported_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")
    captured: dict[str, object] = {}

    def fake_upload(
        url: str,
        *,
        wav_bytes: bytes,
        language: str,
        api_key: str,
        timeout_s: float,
    ) -> dict[str, object]:
        captured["language"] = language
        return {"text": "hello"}

    monkeypatch.setattr(http_asr, "_nvidia_multipart_upload", fake_upload)
    provider = NvidiaAsrProvider("nvidia-parakeet-1.1b")
    result = provider.transcribe(make_utterance(), "english")
    assert result.text == "hello"
    assert captured["language"] == "en"


def test_nvidia_transcribe_failure_returns_empty_not_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")

    def failing_upload(url: str, **_: object) -> dict[str, object]:
        raise HttpAsrError("HTTP 401")

    monkeypatch.setattr(http_asr, "_nvidia_multipart_upload", failing_upload)
    provider = NvidiaAsrProvider("nvidia-whisper-large-v3")
    result = provider.transcribe(make_utterance(), "english")
    assert result.text == ""
    assert result.error is not None
    assert "401" in result.error
