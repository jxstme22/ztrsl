from typing import Any

import pytest

from local_squad_inference.http_translation import (
    CustomHttpProvider,
    GoogleTranslateProvider,
    HttpTranslationError,
    LibreTranslateProvider,
    MyMemoryProvider,
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

    monkeypatch.setattr(
        "local_squad_inference.http_translation._http_post_json", fake_post
    )
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

    monkeypatch.setattr(
        "local_squad_inference.http_translation._http_post_json", fake_post
    )
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

    monkeypatch.setattr(
        "local_squad_inference.http_translation._http_post_json", fake_post
    )
    monkeypatch.setenv("LST_CUSTOM_TX_ENDPOINT", "https://example.test/tx")
    monkeypatch.setenv(
        "LST_CUSTOM_TX_BODY_TEMPLATE", '{"q": "{text}", "lang": "{target}"}'
    )
    provider = CustomHttpProvider(target_language="zh")
    provider.translate(_result())
    assert captured["body"] == {"q": "Push A site now", "lang": "zh"}


def test_factory_passes_target_language() -> None:
    assert http_translation_provider("google-translate", "zh")._target == "zh-CN"
    assert http_translation_provider("mymemory", "zh")._target == "zh-CN"
    assert http_translation_provider("mymemory")._target == "en"
    with pytest.raises(HttpTranslationError):
        http_translation_provider("does-not-exist", "zh")


def test_http_providers_keep_working_on_transport_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(url: str, *, timeout_s: float) -> str:
        raise OSError("network down")

    monkeypatch.setattr("local_squad_inference.http_translation._http_get_text", boom)
    provider = GoogleTranslateProvider(target_language="zh")
    result = provider.translate(_result())
    assert result.english_text.startswith("[Google Translate unavailable")
