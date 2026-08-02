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


def _empty_result(
    utterance: AudioUtterance, source_mode: str, error: str | None = None
) -> AsrResult:
    return AsrResult(
        utterance_id=utterance.utterance_id,
        text="",
        source_mode=source_mode,
        is_final=utterance.is_final,
        inference_ms=0.0,
        model_id="groq-whisper",
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
