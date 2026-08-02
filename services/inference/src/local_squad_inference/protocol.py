from __future__ import annotations

import struct
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 1
MAX_CONTROL_MESSAGE_BYTES = 64 * 1024
MAX_AUDIO_MESSAGE_BYTES = 256 * 1024
AUDIO_HEADER = struct.Struct("<4sHH16sQQIHI")
AUDIO_MAGIC = b"LSTA"

SourceMode = Literal["filipino", "cebuano", "english", "chinese", "mixed"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class HelloPayload(StrictModel):
    token: str = Field(min_length=1, max_length=256)
    desktop_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    protocol_versions: list[int] = Field(min_length=1, max_length=8)
    capabilities: list[str] = Field(max_length=16)


class ControlEnvelope(StrictModel):
    protocol_version: int
    message_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=64)
    sent_monotonic_ns: int = Field(ge=0)
    payload: dict[str, Any]


class AudioPacket(StrictModel):
    session_id: bytes = Field(min_length=16, max_length=16)
    sequence: int = Field(ge=0)
    capture_monotonic_ns: int = Field(ge=0)
    sample_rate: int = Field(gt=0, le=384_000)
    channels: int = Field(gt=0, le=32)
    flags: int = Field(ge=0, le=65_535)
    samples: tuple[float, ...]


class CaptionPayload(StrictModel):
    caption_id: str
    utterance_id: str
    revision: int = Field(ge=1)
    status: Literal["provisional", "final"]
    source_mode: SourceMode
    source_text: str = Field(max_length=500)
    # Carries the translation output; the language is the session's
    # target_language (English by default, Chinese when selected).
    english_text: str = Field(max_length=500)
    started_monotonic_ns: int = Field(ge=0)
    ended_monotonic_ns: int | None = Field(default=None, ge=0)
    capture_to_caption_ms: float = Field(ge=0)
    asr_ms: float = Field(ge=0)
    translation_ms: float = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]] = Field(max_length=8)


class ClipProcessPayload(StrictModel):
    path: str = Field(min_length=1, max_length=4096)
    source_mode: Literal["filipino", "cebuano", "chinese", "mixed"]
    provider: Literal["demo", "local"] = "demo"


class LiveStartPayload(StrictModel):
    source_mode: Literal["filipino", "chinese", "english"] = "filipino"
    provider: Literal["demo", "local", "http"] = "local"
    # Translation output language; applies to the local NLLB provider.
    target_language: Literal["en", "zh"] = "en"
    asr_provider: Literal[
        "local",
        "whisper-turbo",
        "whisper-full",
        "ncspeech",
        "ncspeech-zh",
        "ncspeech-zh-parakeet",
        "groq-whisper",
    ] = "local"
    translation_provider: Literal[
        "nllb",
        "madlad",
        "demo",
        "libretranslate",
        "google-translate",
        "mymemory",
        "custom-http",
    ] = "nllb"
    resource_profile: Literal["balanced", "quality"] = "quality"
    vad_sensitivity: int = Field(default=50, ge=0, le=100)


def parse_audio_packet(data: bytes) -> AudioPacket:
    if len(data) > MAX_AUDIO_MESSAGE_BYTES:
        raise ValueError("audio message too large")
    if len(data) < AUDIO_HEADER.size:
        raise ValueError("invalid audio header")
    (
        magic,
        version,
        flags,
        session_id,
        sequence,
        capture_ns,
        sample_rate,
        channels,
        sample_count,
    ) = AUDIO_HEADER.unpack_from(data)
    if magic != AUDIO_MAGIC or version != PROTOCOL_VERSION:
        raise ValueError("invalid audio header")
    payload = data[AUDIO_HEADER.size :]
    if len(payload) != sample_count * 4:
        raise ValueError("invalid audio payload length")
    samples = struct.unpack(f"<{sample_count}f", payload)
    return AudioPacket(
        session_id=session_id,
        sequence=sequence,
        capture_monotonic_ns=capture_ns,
        sample_rate=sample_rate,
        channels=channels,
        flags=flags,
        samples=samples,
    )


def encode_audio_packet(packet: AudioPacket) -> bytes:
    payload = struct.pack(f"<{len(packet.samples)}f", *packet.samples)
    result = (
        AUDIO_HEADER.pack(
            AUDIO_MAGIC,
            PROTOCOL_VERSION,
            packet.flags,
            packet.session_id,
            packet.sequence,
            packet.capture_monotonic_ns,
            packet.sample_rate,
            packet.channels,
            len(packet.samples),
        )
        + payload
    )
    if len(result) > MAX_AUDIO_MESSAGE_BYTES:
        raise ValueError("audio message too large")
    return result
