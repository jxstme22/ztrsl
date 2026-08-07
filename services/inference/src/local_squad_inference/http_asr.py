"""Opt-in remote ASR provider for Groq Whisper.

When selected, each completed utterance (16 kHz mono float PCM) is encoded as
an in-memory WAV and uploaded to Groq's Whisper transcription endpoint. Only
the utterance audio for the current voice activity is sent — nothing is stored
or streamed beyond the request. Local-only operation remains the default.

The provider is intentionally thin: it transcribes one short utterance at a
time and returns an empty transcript on any error so the live session never
dies. A missing API key is validated at construction so misconfiguration
surfaces before listening starts.
"""

from __future__ import annotations

import json
import os
import struct
import time
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any

from local_squad_inference.providers import AsrProvider, AsrResult, whisper_language_code
from local_squad_inference.vad import AudioUtterance


class HttpAsrError(RuntimeError):
    pass


@dataclass(frozen=True)
class GroqConfig:
    endpoint: str = "https://api.groq.com/openai/v1/audio/transcriptions"
    model: str = "whisper-large-v3-turbo"
    timeout_s: float = 15.0


@dataclass(frozen=True)
class NvidiaAsrConfig:
    """NVIDIA ASR invocation endpoint (build.nvidia.com). Each model is a
    function; the same id works for gRPC metadata and the HTTP invocation
    URL. One API key serves every endpoint — configure with
    `LST_NVIDIA_API_KEY` (nvapi-…, free tier)."""

    endpoint: str
    # Language codes the endpoint supports; empty means any. A source mode
    # outside the set is reported as a visible error — never silently
    # rerouted to an unrelated language (DEC-001).
    supported_languages: tuple[str, ...] = ()
    # NVIDIA docs use plain codes for Whisper (en) and BCP-47 region codes
    # for the Riva ASR models (en-US). `simple` sends the 2-letter code.
    language_style: str = "simple"
    timeout_s: float = 30.0


# Function-ids from each model's build.nvidia.com "Try API" page. The HTTP
# endpoint pattern is https://<function-id>.invocation.api.nvcf.nvidia.com/
# v1/audio/transcriptions (multipart: file + language).
NVIDIA_ASR_ENDPOINTS: dict[str, NvidiaAsrConfig] = {
    "nvidia-whisper-large-v3": NvidiaAsrConfig(
        "https://b702f636-f60c-4a3d-a6f4-f3568c13bd7d.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions",
        language_style="simple",
    ),
    "nvidia-nemotron-asr-streaming": NvidiaAsrConfig(
        "https://bb0837de-8c7b-481f-9ec8-ef5663e9c1fa.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions",
        language_style="region",
    ),
    "nvidia-parakeet-1.1b": NvidiaAsrConfig(
        "https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions",
        supported_languages=("en", "de", "es", "fr"),
        language_style="region",
    ),
    "nvidia-canary-1b": NvidiaAsrConfig(
        "https://b0e8b4a5-217c-40b7-9b96-17d84e666317.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions",
        supported_languages=("en", "de", "es", "fr"),
        language_style="region",
    ),
}

# NVIDIA Riva ASR docs use BCP-47 region codes for the non-Whisper models.
RIVA_REGION_CODES: dict[str, str] = {
    "en": "en-US",
    "de": "de-DE",
    "es": "es-US",
    "fr": "fr-FR",
}


def _pcm_f32_to_wav(pcm_f32: tuple[float, ...], sample_rate: int) -> bytes:
    """Encode float32 PCM samples as a 16-bit mono WAV in memory."""
    pcm16 = bytearray()
    for sample in pcm_f32:
        clamped = max(-1.0, min(1.0, sample))
        pcm16 += struct.pack("<h", int(clamped * 32767))
    data_size = len(pcm16)
    byte_rate = sample_rate * 2
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        1,  # mono
        sample_rate,
        byte_rate,
        2,  # block align
        16,  # bits per sample
        b"data",
        data_size,
    )
    return header + bytes(pcm16)


def _multipart_upload(
    url: str,
    *,
    wav_bytes: bytes,
    model: str,
    language: str,
    api_key: str,
    timeout_s: float,
) -> dict[str, Any]:
    boundary = f"----lstasr-{uuid.uuid4().hex}"
    body = bytearray()
    for field_name, filename, content, content_type in (
        ("file", "utterance.wav", wav_bytes, "audio/wav"),
    ):
        body += f"--{boundary}\r\n".encode()
        body += (
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        ).encode()
        body += f"Content-Type: {content_type}\r\n\r\n".encode()
        body += content
        body += b"\r\n"
    for field_name, value in (("model", model), ("language", language)):
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'.encode()
        body += str(value).encode()
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        url,
        data=bytes(body),
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "local-squad-translator/0.1 (opt-in ASR)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        raw = response.read()
    if not raw:
        raise HttpAsrError("empty response body from Groq")
    decoded = raw.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError as error:
        raise HttpAsrError("Groq response was not JSON") from error
    if not isinstance(parsed, dict):
        raise HttpAsrError("Groq response is not a JSON object")
    return parsed


class NvidiaAsrProvider(AsrProvider):
    """Transcribe utterances through NVIDIA NIM ASR APIs (build.nvidia.com).

    Configure with `LST_NVIDIA_API_KEY` (nvapi-…, free tier). One provider
    instance per model id; endpoints follow the invocation-gateway format
    `https://<function-id>.invocation.api.nvcf.nvidia.com/v1/audio/
    transcriptions` (multipart: file + language + response_format). Note
    the free tier only exposes a subset of ASR functions per account —
    an unauthorized function fails with HTTP 500 "inference connection
    error", which is surfaced as a visible error, never as a silent
    fallback.
    """

    def __init__(self, model_id: str) -> None:
        api_key = os.environ.get("LST_NVIDIA_API_KEY", "").strip()
        if not api_key:
            raise HttpAsrError("NVIDIA API key is missing (set LST_NVIDIA_API_KEY)")
        config = NVIDIA_ASR_ENDPOINTS.get(model_id)
        if config is None:
            raise HttpAsrError(f"unknown NVIDIA ASR model: {model_id}")
        self._api_key = api_key
        self._config = config
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        if not utterance.pcm_f32:
            return _empty_result(utterance, source_mode, model_id=self._model_id)
        language = whisper_language_code(source_mode)
        if self._config.supported_languages and language not in self._config.supported_languages:
            return _empty_result(
                utterance,
                source_mode,
                error=(
                    f"{self._model_id} does not support language '{language}'; "
                    "pick a different ASR provider for this source"
                ),
                model_id=self._model_id,
            )
        if self._config.language_style == "region":
            language = RIVA_REGION_CODES.get(language, language)
        wav_bytes = _pcm_f32_to_wav(utterance.pcm_f32, utterance.sample_rate)
        started = time.perf_counter()
        try:
            data = _nvidia_multipart_upload(
                self._config.endpoint,
                wav_bytes=wav_bytes,
                language=language,
                api_key=self._api_key,
                timeout_s=self._config.timeout_s,
            )
            text = _nvidia_transcript_text(data)
        except (HttpAsrError, OSError, ValueError, KeyError, TypeError) as error:
            reason = getattr(error, "message", str(error)) or str(type(error).__name__)
            return _empty_result(utterance, source_mode, error=reason, model_id=self._model_id)
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=utterance.is_final,
            inference_ms=(time.perf_counter() - started) * 1_000.0,
            model_id=self._model_id,
            confidence=None,
        )


def _nvidia_transcript_text(data: dict[str, Any]) -> str:
    """Extract the transcript from NVIDIA invocation responses. The shape
    varies by model: a top-level ``text`` field or a ``transcriptions``
    list (Riva-style). Never returns a placeholder silently."""
    text = data.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    for item in data.get("transcriptions") or []:
        if isinstance(item, dict):
            candidate = item.get("text")
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
    return ""


def _nvidia_multipart_upload(
    url: str,
    *,
    wav_bytes: bytes,
    language: str,
    api_key: str,
    timeout_s: float,
) -> dict[str, Any]:
    boundary = f"----lstnvidia-{uuid.uuid4().hex}"
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="file"; filename="utterance.wav"\r\n'
    body += b"Content-Type: audio/wav\r\n\r\n"
    body += wav_bytes
    body += b"\r\n"
    for field_name, value in (("language", language), ("response_format", "json")):
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'.encode()
        body += str(value).encode()
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        url,
        data=bytes(body),
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "local-squad-translator/0.1 (opt-in ASR)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        raw = response.read()
    if not raw:
        raise HttpAsrError("empty response body from NVIDIA ASR")
    decoded = raw.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError as error:
        raise HttpAsrError("NVIDIA ASR response was not JSON") from error
    if not isinstance(parsed, dict):
        raise HttpAsrError("NVIDIA ASR response is not a JSON object")
    return parsed


def _empty_result(
    utterance: AudioUtterance,
    source_mode: str,
    error: str | None = None,
    model_id: str = "groq-whisper",
) -> AsrResult:
    return AsrResult(
        utterance_id=utterance.utterance_id,
        text="",
        source_mode=source_mode,
        is_final=utterance.is_final,
        inference_ms=0.0,
        model_id=model_id,
        confidence=None,
        error=error,
    )


class GroqWhisperProvider(AsrProvider):
    """Transcribe utterances through Groq's free-tier Whisper API.

    Configure with `LST_GROQ_API_KEY` (https://console.groq.com/keys). The
    source language is derived from the active source mode: Tagalog/Cebuano
    sends `tl`, Chinese sends `zh`.
    """

    PROVIDER_ID = "groq-whisper"

    def __init__(self, config: GroqConfig | None = None) -> None:
        api_key = os.environ.get("LST_GROQ_API_KEY", "").strip()
        if not api_key:
            raise HttpAsrError("Groq API key is missing (set LST_GROQ_API_KEY)")
        self._api_key = api_key
        self._config = config or GroqConfig()

    @property
    def model_id(self) -> str:
        return self._config.model

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        if not utterance.pcm_f32:
            return _empty_result(utterance, source_mode)
        wav_bytes = _pcm_f32_to_wav(utterance.pcm_f32, utterance.sample_rate)
        language = whisper_language_code(source_mode)
        started = time.perf_counter()
        try:
            data = _multipart_upload(
                self._config.endpoint,
                wav_bytes=wav_bytes,
                model=self._config.model,
                language=language,
                api_key=self._api_key,
                timeout_s=self._config.timeout_s,
            )
            text = str(data.get("text", "")).strip()
        except (HttpAsrError, OSError, ValueError, KeyError, TypeError) as error:
            # A single failed upload must never kill the live session. Return an
            # empty transcript carrying the failure reason so the pipeline can
            # surface a visible placeholder instead of going silent. Missing-key
            # misconfiguration is caught earlier at construction.
            reason = getattr(error, "message", str(error)) or str(type(error).__name__)
            return _empty_result(utterance, source_mode, error=reason)
        return AsrResult(
            utterance_id=utterance.utterance_id,
            text=text,
            source_mode=source_mode,
            is_final=utterance.is_final,
            inference_ms=(time.perf_counter() - started) * 1_000.0,
            model_id=self.PROVIDER_ID,
            confidence=None,
        )
