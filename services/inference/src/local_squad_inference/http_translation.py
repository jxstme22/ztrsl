"""HTTP translation providers for the optional opt-in translation API mode.

All providers are opt-in: when one is selected, the recognized Tagalog/Chinese
source transcript (text only — never raw audio) is sent over HTTP to the
configured endpoint. Local-only operation remains the default.

These providers are intentionally thin: they translate one short utterance at
a time and return a placeholder on any error so the live session never dies.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from local_squad_inference.providers import AsrResult, TranslationProvider, TranslationResult


class HttpTranslationError(RuntimeError):
    pass


HTTP_TARGET_CODES: dict[str, dict[str, str]] = {
    "libretranslate": {"en": "en", "zh": "zh"},
    "google-translate": {"en": "en", "zh": "zh-CN"},
    "mymemory": {"en": "en", "zh": "zh-CN"},
    "custom-http": {"en": "en", "zh": "zh"},
}


@dataclass(frozen=True)
class HttpProviderConfig:
    endpoint: str
    api_key: str | None = None
    source_lang: str | None = None
    timeout_s: float = 8.0


def _http_post_json(
    url: str,
    body: dict[str, Any],
    *,
    timeout_s: float,
    api_key: str | None = None,
) -> dict[str, Any]:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "local-squad-translator/0.1 (opt-in translation)",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(url, data=payload, method="POST", headers=headers)
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        raw = response.read()
    if not raw:
        raise HttpTranslationError("empty response body")
    decoded = raw.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(decoded)
        if not isinstance(parsed, dict):
            raise HttpTranslationError("response is not a JSON object")
        return parsed
    except json.JSONDecodeError as error:
        raise HttpTranslationError("response was not JSON") from error


def _http_get_text(url: str, *, timeout_s: float) -> str:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "local-squad-translator/0.1 (opt-in translation)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        return str(response.read().decode("utf-8", errors="replace"))


def _ok(
    result: AsrResult,
    english_text: str,
    *,
    inference_ms: float,
    provider_id: str,
) -> TranslationResult:
    return TranslationResult(
        utterance_id=result.utterance_id,
        source_text=result.text,
        english_text=english_text,
        is_final=True,
        inference_ms=inference_ms,
        model_id=provider_id,
    )


def _placeholder(
    result: AsrResult,
    message: str,
    *,
    provider_id: str,
    inference_ms: float = 0.0,
) -> TranslationResult:
    return TranslationResult(
        utterance_id=result.utterance_id,
        source_text=result.text,
        english_text=message,
        is_final=True,
        inference_ms=inference_ms,
        model_id=provider_id,
    )


class LibreTranslateProvider(TranslationProvider):
    """LibreTranslate-compatible provider. Works against any instance URL.

    Configure with `LST_LT_ENDPOINT` (e.g. https://libretranslate.com/translate
    or a self-hosted /public mirror).
    Optional `LST_LT_API_KEY` for instances that require one, and
    `LST_LT_SOURCE` (defaults to "auto").
    """

    PROVIDER_ID = "libretranslate"

    def __init__(self, target_language: str = "en") -> None:
        endpoint = os.environ.get("LST_LT_ENDPOINT", "").strip()
        if not endpoint:
            raise HttpTranslationError("LibreTranslate endpoint is missing (set LST_LT_ENDPOINT)")
        self._endpoint = endpoint
        self._api_key = os.environ.get("LST_LT_API_KEY") or None
        self._source = os.environ.get("LST_LT_SOURCE", "auto")
        self._target = HTTP_TARGET_CODES[self.PROVIDER_ID].get(target_language, target_language)

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return _ok(result, "", inference_ms=0.0, provider_id=self.PROVIDER_ID)
        body = {
            "q": result.text,
            "source": self._source,
            "target": self._target,
            "format": "text",
        }
        if self._api_key:
            body["api_key"] = self._api_key
        started = time.perf_counter()
        try:
            data = _http_post_json(
                self._endpoint,
                body,
                timeout_s=8.0,
                api_key=None,  # LibreTranslate uses body api_key, not bearer
            )
            english_text = str(data.get("translatedText", "")).strip()
            if not english_text:
                return _placeholder(
                    result,
                    "[LibreTranslate returned no text]",
                    provider_id=self.PROVIDER_ID,
                )
            return _ok(
                result,
                english_text,
                inference_ms=(time.perf_counter() - started) * 1_000.0,
                provider_id=self.PROVIDER_ID,
            )
        except (HttpTranslationError, OSError, ValueError, KeyError) as error:
            return _placeholder(
                result,
                f"[LibreTranslate unavailable: {error}]",
                provider_id=self.PROVIDER_ID,
            )


class GoogleTranslateProvider(TranslationProvider):
    """Google Translate free unofficial endpoint.

    Uses `https://translate.googleapis.com/translate_a/single?client=gtx`
    with `dt=t`. No API key required. This is an *unofficial* endpoint used
    by many open-source libraries; it may rate-limit or change without notice.
    """

    PROVIDER_ID = "google-translate"
    ENDPOINT = "https://translate.googleapis.com/translate_a/single"
    DEFAULT_SOURCE = "auto"

    def __init__(self, target_language: str = "en") -> None:
        # Allow overriding endpoint for testing or self-hosted Google-compatible proxies.
        self._endpoint = os.environ.get("LST_GOOGLE_TX_ENDPOINT", self.ENDPOINT)
        self._source = os.environ.get("LST_GOOGLE_TX_SOURCE", self.DEFAULT_SOURCE)
        self._target = HTTP_TARGET_CODES[self.PROVIDER_ID].get(target_language, target_language)

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return _ok(result, "", inference_ms=0.0, provider_id=self.PROVIDER_ID)
        params = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": self._source,
                "tl": self._target,
                "dt": "t",
                "q": result.text,
            },
            safe="",
        )
        url = f"{self._endpoint}?{params}"
        started = time.perf_counter()
        try:
            body = _http_get_text(url, timeout_s=8.0)
            parsed = json.loads(body)
            # Google returns nested arrays: [["<translated chunk>","<source chunk>",...],...].
            chunks = parsed[0] if isinstance(parsed, list) and parsed else []
            parts = [
                str(chunk[0]) for chunk in chunks if isinstance(chunk, list) and chunk and chunk[0]
            ]
            english_text = "".join(parts).strip()
            if not english_text:
                return _placeholder(
                    result,
                    "[Google Translate returned no text]",
                    provider_id=self.PROVIDER_ID,
                )
            return _ok(
                result,
                english_text,
                inference_ms=(time.perf_counter() - started) * 1_000.0,
                provider_id=self.PROVIDER_ID,
            )
        except (
            HttpTranslationError,
            OSError,
            ValueError,
            KeyError,
            json.JSONDecodeError,
            IndexError,
            TypeError,
        ) as error:
            return _placeholder(
                result,
                f"[Google Translate unavailable: {error}]",
                provider_id=self.PROVIDER_ID,
            )


class MyMemoryProvider(TranslationProvider):
    """MyMemory Translated API. ~5,000 chars/day with 500 chars/request.

    Uses `https://api.mymemory.translated.net/get?q=...&langpair=src|en`.
    No API key required for the free tier; `de` (contact email) is optional.
    """

    PROVIDER_ID = "mymemory"
    ENDPOINT = "https://api.mymemory.translated.net/get"

    def __init__(self, target_language: str = "en") -> None:
        self._endpoint = os.environ.get("LST_MYMEMORY_ENDPOINT", self.ENDPOINT)
        self._source = os.environ.get("LST_MYMEMORY_SOURCE", "autodetect")
        self._de = os.environ.get("LST_MYMEMORY_EMAIL") or None
        self._target = HTTP_TARGET_CODES[self.PROVIDER_ID].get(target_language, target_language)

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return _ok(result, "", inference_ms=0.0, provider_id=self.PROVIDER_ID)
        params = {
            "q": result.text,
            "langpair": f"{self._source}|{self._target}",
        }
        if self._de:
            params["de"] = self._de
        url = f"{self._endpoint}?{urllib.parse.urlencode(params, safe='')}"
        started = time.perf_counter()
        try:
            data = _http_post_json(url, {}, timeout_s=8.0)  # GET-style endpoint with POST body
            response_data = data.get("responseData") or {}
            english_text = str(response_data.get("translatedText", "")).strip()
            if not english_text:
                return _placeholder(
                    result,
                    "[MyMemory returned no text]",
                    provider_id=self.PROVIDER_ID,
                )
            return _ok(
                result,
                english_text,
                inference_ms=(time.perf_counter() - started) * 1_000.0,
                provider_id=self.PROVIDER_ID,
            )
        except (HttpTranslationError, OSError, ValueError, KeyError, TypeError) as error:
            return _placeholder(
                result,
                f"[MyMemory unavailable: {error}]",
                provider_id=self.PROVIDER_ID,
            )


class CustomHttpProvider(TranslationProvider):
    """Generic HTTP translation provider — bring your own endpoint.

    Expects a JSON POST endpoint that returns `{"translatedText": "..."}` or
    `{"translation": "..."}` or `{"englishText": "..."}` (case-insensitive).
    Configure with `LST_CUSTOM_TX_ENDPOINT` and (optional) `LST_CUSTOM_TX_API_KEY`.
    Optional `LST_CUSTOM_TX_BODY_TEMPLATE` (a JSON template with `{text}` and
    `{source}` placeholders) overrides the default request body.
    """

    PROVIDER_ID = "custom-http"

    def __init__(self, target_language: str = "en") -> None:
        endpoint = os.environ.get("LST_CUSTOM_TX_ENDPOINT", "").strip()
        if not endpoint:
            raise HttpTranslationError("custom HTTP endpoint missing (set LST_CUSTOM_TX_ENDPOINT)")
        self._endpoint = endpoint
        self._api_key = os.environ.get("LST_CUSTOM_TX_API_KEY") or None
        self._template = os.environ.get("LST_CUSTOM_TX_BODY_TEMPLATE")
        self._target = HTTP_TARGET_CODES[self.PROVIDER_ID].get(target_language, target_language)

    def translate(self, result: AsrResult) -> TranslationResult:
        if not result.text:
            return _ok(result, "", inference_ms=0.0, provider_id=self.PROVIDER_ID)
        if self._template:
            body_str = (
                self._template.replace(
                    "{text}", result.text.replace("\\", "\\\\").replace('"', '\\"')
                )
                .replace("{source}", "auto")
                .replace("{target}", self._target)
            )
            try:
                body = json.loads(body_str)
            except json.JSONDecodeError as error:
                return _placeholder(
                    result,
                    f"[custom template invalid JSON: {error}]",
                    provider_id=self.PROVIDER_ID,
                )
        else:
            body = {
                "text": result.text,
                "source": "auto",
                "target": self._target,
            }
        started = time.perf_counter()
        try:
            data = _http_post_json(
                self._endpoint,
                body,
                timeout_s=8.0,
                api_key=self._api_key,
            )
            english_text = (
                data.get("translatedText") or data.get("translation") or data.get("englishText")
            )
            if not isinstance(english_text, str):
                # Fall back to any string value present under common keys.
                for value in data.values():
                    if isinstance(value, str):
                        english_text = value
                        break
            english_text = str(english_text or "").strip()
            if not english_text:
                return _placeholder(
                    result,
                    "[custom endpoint returned no text]",
                    provider_id=self.PROVIDER_ID,
                )
            return _ok(
                result,
                english_text,
                inference_ms=(time.perf_counter() - started) * 1_000.0,
                provider_id=self.PROVIDER_ID,
            )
        except (HttpTranslationError, OSError, ValueError, KeyError, TypeError) as error:
            return _placeholder(
                result,
                f"[custom endpoint unavailable: {error}]",
                provider_id=self.PROVIDER_ID,
            )


HTTP_PROVIDER_FACTORIES: dict[str, Callable[..., TranslationProvider]] = {
    "libretranslate": LibreTranslateProvider,
    "google-translate": GoogleTranslateProvider,
    "mymemory": MyMemoryProvider,
    "custom-http": CustomHttpProvider,
}


def http_translation_provider(name: str, target_language: str = "en") -> TranslationProvider:
    factory = HTTP_PROVIDER_FACTORIES.get(name)
    if factory is None:
        raise HttpTranslationError(f"unknown HTTP translation provider: {name}")
    return factory(target_language=target_language)
