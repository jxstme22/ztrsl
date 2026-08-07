from __future__ import annotations

import re
import struct
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PROTOCOL_VERSION = 1
PROTOCOL_V2 = 2
MAX_CONTROL_MESSAGE_BYTES = 64 * 1024
MAX_AUDIO_MESSAGE_BYTES = 256 * 1024
AUDIO_HEADER = struct.Struct("<4sHH16sQQIHI")
AUDIO_HEADER_V2 = struct.Struct("<4sHH16sQQIHI16s")
AUDIO_MAGIC = b"LSTA"

CAPABILITY_IPC_V2 = "ipc_v2"
CAPABILITY_MULTI_SOURCE = "multi_source"

SourceMode = Literal[
    "filipino",
    "cebuano",
    "english",
    "chinese",
    "mixed",
    "indonesian",
    "vietnamese",
    "thai",
    "malay",
]

LabelStyle = Literal["brackets", "colon", "bullet", "stacked", "hidden"]
Strictness = Literal["off", "balanced", "strict"]
FilterApplied = Literal["off", "suppressed", "flagged", "passed"]
UncertaintyReason = Literal[
    "overlapping_speech",
    "low_asr_confidence",
    "unexpected_language",
    "audio_clipping",
    "segment_too_short",
    "translation_instability",
]
SuppressionReason = Literal[
    "heavy_overlap",
    "low_confidence",
    "unexpected_language",
    "phrase_filter",
    "clipping",
]

_SOURCE_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def negotiate_protocol_version(
    proposed: list[int], supported: tuple[int, ...] = (PROTOCOL_VERSION, PROTOCOL_V2)
) -> int:
    """Highest protocol version both peers propose. Raises ValueError when
    none match (the caller closes the connection)."""
    for version in proposed:
        if version in supported:
            return version
    raise ValueError(f"no common protocol version: proposed={proposed}")


def parse_source_id_hex(value: str) -> bytes:
    if not isinstance(value, str) or not _SOURCE_ID_RE.match(value):
        raise ValueError("invalid source id: must be 32 lowercase hex chars")
    return bytes.fromhex(value)


def encode_source_id_hex(raw: bytes) -> str:
    if len(raw) != 16:
        raise ValueError(f"invalid source id bytes: {len(raw)}")
    return raw.hex()


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


class AudioPacketV2(StrictModel):
    session_id: bytes = Field(min_length=16, max_length=16)
    sequence: int = Field(ge=0)
    capture_monotonic_ns: int = Field(ge=0)
    sample_rate: int = Field(gt=0, le=384_000)
    channels: int = Field(gt=0, le=32)
    flags: int = Field(ge=0, le=65_535)
    source_id: bytes = Field(min_length=16, max_length=16)
    samples: tuple[float, ...]


class SourceSnapshot(StrictModel):
    display_name: str = Field(min_length=1, max_length=48)
    caption_tag: str = Field(min_length=1, max_length=32)
    label_style: LabelStyle
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")


class CaptionCertainty(StrictModel):
    """v0.4 certainty state (BUILD_PLAN_V0_4 §4). One of:
    - `normal` — no qualification;
    - `uncertain` — shown with `uncertainty_reasons` (e.g. overlapping speech);
    - `suppressed` — withheld; the overlay hides it, never flashes it briefly.
    Suppressed captions are still sent so the overlay can show *why*.
    """

    state: Literal["normal", "uncertain", "suppressed"]
    uncertainty_reasons: list[UncertaintyReason] = Field(default_factory=list, max_length=4)
    suppression_reason: SuppressionReason | None = None


class CaptionPayload(StrictModel):
    caption_id: str
    utterance_id: str
    revision: int = Field(ge=1)
    status: Literal["provisional", "final"]
    source_mode: SourceMode
    source_text: str = Field(max_length=8000)
    # Carries the translation output; the language is the session's
    # target_language (English by default, Chinese when selected).
    english_text: str = Field(max_length=8000)
    started_monotonic_ns: int = Field(ge=0)
    ended_monotonic_ns: int | None = Field(default=None, ge=0)
    capture_to_caption_ms: float = Field(ge=0)
    asr_ms: float = Field(ge=0)
    translation_ms: float = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]] = Field(max_length=8)
    # ---- v2 fields (IPC v2 sessions only) ----
    source_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    source_snapshot: SourceSnapshot | None = None
    strictness: Strictness | None = None
    filter_applied: FilterApplied | None = None
    filter_reason: str | None = Field(default=None, max_length=128)
    certainty: CaptionCertainty | None = None


# v2-only fields; stripped from the wire for v1 sessions so v1 captions are
# byte-identical to v0.2 output.
_V2_CAPTION_FIELDS = frozenset(
    {
        "source_id",
        "source_snapshot",
        "strictness",
        "filter_applied",
        "filter_reason",
        "certainty",
    }
)


def dump_caption(caption: CaptionPayload, *, include_v2: bool) -> dict[str, Any]:
    """Serialize a caption for the wire. v1 sessions exclude v2-only keys."""
    data = caption.model_dump(mode="json")
    if not include_v2:
        for key in _V2_CAPTION_FIELDS:
            data.pop(key, None)
    return data


class LanguageConfig(StrictModel):
    """DS-201: explicit recognition language intent. `fixed` and
    `primary_preferred` require a primary language; `limited_auto` requires
    at least one allowed language; the primary language may not repeat in
    the secondary list. Language ids use the canonical ISO 639-1/2 form."""

    primary_language: str | None = Field(default=None, pattern=r"^[a-z]{2,3}$")
    secondary_languages: list[str] = Field(default_factory=list, max_length=8)
    detection_mode: Literal["fixed", "primary_preferred", "limited_auto", "full_auto"] = "full_auto"

    @model_validator(mode="after")
    def validate_rules(self) -> LanguageConfig:
        if self.detection_mode in {"fixed", "primary_preferred"} and self.primary_language is None:
            raise ValueError("fixed and primary_preferred require a primary language")
        if self.detection_mode == "limited_auto" and not self.secondary_languages:
            raise ValueError("limited_auto requires at least one allowed language")
        if self.primary_language is not None and self.primary_language in self.secondary_languages:
            raise ValueError("primary language cannot be duplicated in secondary languages")
        return self


class SourceRegistryEntry(StrictModel):
    source_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    display_name: str = Field(min_length=1, max_length=48)
    caption_tag: str = Field(min_length=1, max_length=32)
    capture_target: dict[str, Any] = Field(default_factory=dict)
    language_profile: str = Field(default="auto", max_length=32)
    strictness: Strictness = "balanced"
    label_style: LabelStyle = "brackets"
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    # Scheduling priority (spec §7.2): higher numbers decode first within
    # the final/provisional tiers. Never derived from names or tags.
    priority: int = Field(default=100, ge=0, le=1000)
    # DS-200/201: audio origin and explicit language configuration. Optional
    # so v2 payloads from older desktops still validate.
    source_origin: Literal[
        "virtual_voice_channel",
        "physical_microphone",
        "application_audio",
        "system_mix",
        "recorded_file",
    ] = "virtual_voice_channel"
    language_config: LanguageConfig | None = None


class SourceRegistryPayload(StrictModel):
    sources: list[SourceRegistryEntry] = Field(min_length=1, max_length=8)


class SourcePresentationUpdatePayload(StrictModel):
    source_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    source_snapshot: SourceSnapshot


class SourceControlPayload(StrictModel):
    """Payload for per-source controls (source.flush, source.stop,
    source.diagnostics.request). Phase 5 per-source VAD lifecycle."""

    source_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class ClipProcessPayload(StrictModel):
    path: str = Field(min_length=1, max_length=4096)
    source_mode: Literal["filipino", "cebuano", "chinese", "mixed"]
    provider: Literal["demo", "local"] = "demo"


class ClipComparePayload(StrictModel):
    """v0.4 Accuracy Lab: run one clip through multiple provider configs."""

    path: str = Field(min_length=1, max_length=4096)
    source_mode: Literal["filipino", "cebuano", "chinese", "mixed", "english"]
    # Each config is [asr_name, translation_name]; empty defaults to known
    # installed configs. Names must be resolvable by build_asr_provider /
    # build_translation_provider.
    configs: list[list[str]] = Field(default_factory=list, max_length=8)
    include_transcripts: bool = False


class LiveStartPayload(StrictModel):
    source_mode: Literal[
        "filipino", "chinese", "english", "indonesian", "vietnamese", "thai", "malay"
    ] = "filipino"
    provider: Literal["demo", "local", "http"] = "local"
    # Translation output language; applies to the local NLLB provider.
    target_language: Literal["en", "zh", "fil", "ind", "vie", "tha", "zsm"] = "en"
    asr_provider: Literal[
        "local",
        "whisper-turbo",
        "whisper-full",
        "ncspeech",
        "ncspeech-zh",
        "ncspeech-zh-parakeet",
        "mlx",
        "mlx-whisper",
        "paraformer-zh-streaming",
        "sensevoice-small",
        "groq-whisper",
    ] = "local"
    translation_provider: Literal[
        "nllb",
        "madlad",
        "opus-mt-en-zh",
        "opus-mt-zh-en",
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


def parse_audio_packet_v2(data: bytes) -> AudioPacketV2:
    if len(data) > MAX_AUDIO_MESSAGE_BYTES:
        raise ValueError("audio message too large")
    if len(data) < AUDIO_HEADER_V2.size:
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
        source_id,
    ) = AUDIO_HEADER_V2.unpack_from(data)
    if magic != AUDIO_MAGIC or version != PROTOCOL_V2:
        raise ValueError("invalid audio header")
    payload = data[AUDIO_HEADER_V2.size :]
    if len(payload) != sample_count * 4:
        raise ValueError("invalid audio payload length")
    samples = struct.unpack(f"<{sample_count}f", payload)
    return AudioPacketV2(
        session_id=session_id,
        sequence=sequence,
        capture_monotonic_ns=capture_ns,
        sample_rate=sample_rate,
        channels=channels,
        flags=flags,
        source_id=source_id,
        samples=samples,
    )


def encode_audio_packet_v2(packet: AudioPacketV2) -> bytes:
    payload = struct.pack(f"<{len(packet.samples)}f", *packet.samples)
    result = (
        AUDIO_HEADER_V2.pack(
            AUDIO_MAGIC,
            PROTOCOL_V2,
            packet.flags,
            packet.session_id,
            packet.sequence,
            packet.capture_monotonic_ns,
            packet.sample_rate,
            packet.channels,
            len(packet.samples),
            packet.source_id,
        )
        + payload
    )
    if len(result) > MAX_AUDIO_MESSAGE_BYTES:
        raise ValueError("audio message too large")
    return result
