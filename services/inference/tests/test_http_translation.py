from typing import Any

import pytest

from local_squad_inference.http_translation import (
    CustomHttpProvider,
    GoogleTranslateProvider,
    HttpTranslationError,
    LibreTranslateProvider,
    MyMemoryProvider,
    NvidiaRivaProvider,
    http_translation_provider,
)
from local_squad_inference.providers import AsrResult


def _result(text: str = "Push A site now") -> AsrResult:
    return AsrResult(
        utterance_id="u1",
        text=text,
        source_mode="english",
        is_final=True,
        inference_ms=5.0,
        model_id="whisper-large-v3-turbo",
        confidence=0.9,
    )


def test_google_translate_uses_zh_cn_target(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_get(url: str, *, timeout_s: float) -> str:
        captured["url"] = url
        return (
            '[[["我们需要推进A点","We need to push A","null",null,10]],'
            'null,"en",[[["We need to push A"]]]]'
        )

    monkeypatch.setattr("local_squad_inference.http_translation._http_get_text", fake_get)
    provider = GoogleTranslateProvider(target_language="zh")
    result = provider.translate(_result())
    assert "tl=zh-CN" in captured["url"]
    assert result.english_text == "我们需要推进A点"


def test_google_translate_default_target_is_english(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_get(url: str, *, timeout_s: float) -> str:
        captured["url"] = url
        return '[[["We need to push A","我们需要推进A点",null,null,10]]]'

    monkeypatch.setattr("local_squad_inference.http_translation._http_get_text", fake_get)
    provider = GoogleTranslateProvider()
    provider.translate(_result())
    assert "tl=en" in captured["url"]


def test_mymemory_uses_zh_cn_target(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str, body: dict[str, Any], *, timeout_s: float, api_key: str | None = None
    ) -> dict[str, Any]:
        captured["url"] = url
        captured["body"] = body
        return {"responseData": {"translatedText": "我们需要推进A点"}}

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    provider = MyMemoryProvider(target_language="zh")
    result = provider.translate(_result())
    assert captured["url"].endswith("autodetect%7Czh-CN")
    assert result.english_text == "我们需要推进A点"


def test_libretranslate_uses_zh_target(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str, body: dict[str, Any], *, timeout_s: float, api_key: str | None = None
    ) -> dict[str, Any]:
        captured["body"] = body
        return {"translatedText": "我们需要推进A点"}

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    monkeypatch.setenv("LST_LT_ENDPOINT", "https://example.test/translate")
    provider = LibreTranslateProvider(target_language="zh")
    result = provider.translate(_result())
    assert captured["body"]["target"] == "zh"
    assert result.english_text == "我们需要推进A点"


def test_custom_http_uses_zh_target(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str, body: dict[str, Any], *, timeout_s: float, api_key: str | None = None
    ) -> dict[str, Any]:
        captured["body"] = body
        return {"translatedText": "我们需要推进A点"}

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    monkeypatch.setenv("LST_CUSTOM_TX_ENDPOINT", "https://example.test/tx")
    provider = CustomHttpProvider(target_language="zh")
    result = provider.translate(_result())
    assert captured["body"]["target"] == "zh"
    assert result.english_text == "我们需要推进A点"


def test_custom_http_template_gets_target_placeholder(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(
        url: str, body: dict[str, Any], *, timeout_s: float, api_key: str | None = None
    ) -> dict[str, Any]:
        captured["body"] = body
        return {"translatedText": "我们需要推进A点"}

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    monkeypatch.setenv("LST_CUSTOM_TX_ENDPOINT", "https://example.test/tx")
    monkeypatch.setenv("LST_CUSTOM_TX_BODY_TEMPLATE", '{"q": "{text}", "lang": "{target}"}')
    provider = CustomHttpProvider(target_language="zh")
    provider.translate(_result())
    assert captured["body"] == {"q": "Push A site now", "lang": "zh"}


def test_factory_passes_target_language() -> None:
    assert http_translation_provider("google-translate", "zh")._target == "zh-CN"  # type: ignore[attr-defined]
    assert http_translation_provider("mymemory", "zh")._target == "zh-CN"  # type: ignore[attr-defined]
    assert http_translation_provider("mymemory")._target == "en"  # type: ignore[attr-defined]
    with pytest.raises(HttpTranslationError):
        http_translation_provider("does-not-exist", "zh")


def test_http_providers_keep_working_on_transport_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(url: str, *, timeout_s: float) -> str:
        raise OSError("network down")

    monkeypatch.setattr("local_squad_inference.http_translation._http_get_text", boom)
    provider = GoogleTranslateProvider(target_language="zh")
    result = provider.translate(_result())
    assert result.english_text.startswith("[Google Translate unavailable")


def test_nvidia_riva_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LST_NVIDIA_API_KEY", raising=False)
    with pytest.raises(HttpTranslationError):
        NvidiaRivaProvider("nvidia-riva-4b", target_language="zh")


def test_nvidia_riva_translates_via_chat_completions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")
    captured: dict[str, object] = {}

    def fake_post(
        url: str,
        body: dict[str, object],
        *,
        timeout_s: float,
        api_key: str | None,
    ) -> dict[str, object]:
        captured["url"] = url
        captured["model"] = body.get("model")
        captured["api_key"] = api_key
        messages = body.get("messages")
        first = messages[0] if isinstance(messages, list) and messages else {}
        captured["system"] = str(first.get("content") if isinstance(first, dict) else "")
        return {
            "choices": [
                {"message": {"content": "上A点"}},
            ]
        }

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    provider = NvidiaRivaProvider("nvidia-riva-4b", target_language="zh")
    result = provider.translate(_result("Push A site now"))
    assert result.english_text == "上A点"
    assert captured["url"] == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert captured["model"] == "nvidia/riva-translate-4b-instruct-v1.1"
    assert captured["api_key"] == "nvapi_test"
    assert "Chinese" in str(captured["system"])


def test_nvidia_riva_1_6b_uses_its_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")
    captured: dict[str, object] = {}

    def fake_post(
        url: str,
        body: dict[str, object],
        *,
        timeout_s: float,
        api_key: str | None,
    ) -> dict[str, object]:
        captured["model"] = body.get("model")
        return {"choices": [{"message": {"content": "hello"}}]}

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", fake_post)
    provider = NvidiaRivaProvider("nvidia-riva-1.6b", target_language="en")
    result = provider.translate(_result())
    assert result.english_text == "hello"
    assert captured["model"] == "nvidia/riva-translate-1.6b"


def test_nvidia_riva_failure_returns_placeholder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LST_NVIDIA_API_KEY", "nvapi_test")

    def failing_post(
        url: str,
        body: dict[str, object],
        *,
        timeout_s: float,
        api_key: str | None,
    ) -> dict[str, object]:
        raise HttpTranslationError("HTTP 500")

    monkeypatch.setattr("local_squad_inference.http_translation._http_post_json", failing_post)
    provider = NvidiaRivaProvider("nvidia-riva-4b", target_language="en")
    result = provider.translate(_result())
    assert result.english_text.startswith("[NVIDIA Riva unavailable")
    assert result.is_final is True
