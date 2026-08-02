import pytest

from local_squad_inference.http_asr import GroqWhisperProvider
from local_squad_inference.providers import (
    DemoAsrProvider,
)
from local_squad_inference.sidecar import build_asr_provider


def test_build_asr_provider_aliases(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeWhisper:
        def __init__(self, model_dir: object, **kwargs: object) -> None:
            pass

    class FakeNemo:
        def __init__(self, model_dir: object, **kwargs: object) -> None:
            pass

    import local_squad_inference.sidecar as sidecar

    monkeypatch.setattr(sidecar, "FasterWhisperProvider", FakeWhisper)
    monkeypatch.setattr(sidecar, "NemoCtcProvider", FakeNemo)
    monkeypatch.setenv("LST_GROQ_API_KEY", "gsk_test")

    assert isinstance(build_asr_provider("local"), FakeWhisper)
    assert isinstance(build_asr_provider(""), FakeWhisper)
    assert isinstance(build_asr_provider("whisper-turbo"), FakeWhisper)
    assert isinstance(build_asr_provider("whisper-full"), FakeWhisper)
    assert isinstance(build_asr_provider("ncspeech"), FakeNemo)
    assert isinstance(build_asr_provider("ncspeech-zh"), FakeNemo)
    assert isinstance(build_asr_provider("ncspeech-zh-parakeet"), FakeNemo)
    assert isinstance(build_asr_provider("demo"), DemoAsrProvider)
    assert isinstance(build_asr_provider("groq-whisper"), GroqWhisperProvider)


def test_build_asr_provider_unknown_raises() -> None:
    from local_squad_inference.http_asr import HttpAsrError

    try:
        build_asr_provider("bogus")
    except HttpAsrError as error:
        assert "unknown ASR provider" in str(error)
    else:
        raise AssertionError("expected HttpAsrError")
