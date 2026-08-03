import pytest

from local_squad_inference.protocol import (
    AUDIO_HEADER_V2,
    PROTOCOL_V2,
    PROTOCOL_VERSION,
    AudioPacket,
    AudioPacketV2,
    CaptionPayload,
    SourceSnapshot,
    dump_caption,
    encode_audio_packet,
    encode_audio_packet_v2,
    encode_source_id_hex,
    negotiate_protocol_version,
    parse_audio_packet,
    parse_audio_packet_v2,
    parse_source_id_hex,
)


def test_binary_audio_packet_round_trips() -> None:
    packet = AudioPacket(
        session_id=b"0123456789abcdef",
        sequence=7,
        capture_monotonic_ns=42,
        sample_rate=16_000,
        channels=1,
        flags=0,
        samples=(0.25, -0.5, 0.75),
    )

    assert parse_audio_packet(encode_audio_packet(packet)) == packet


def test_binary_audio_packet_rejects_truncation() -> None:
    packet = AudioPacket(
        session_id=b"0123456789abcdef",
        sequence=1,
        capture_monotonic_ns=2,
        sample_rate=16_000,
        channels=1,
        flags=0,
        samples=(0.25,),
    )
    encoded = encode_audio_packet(packet)

    with pytest.raises(ValueError, match="payload length"):
        parse_audio_packet(encoded[:-1])


def v2_packet() -> AudioPacketV2:
    return AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=3,
        capture_monotonic_ns=99,
        sample_rate=16_000,
        channels=1,
        flags=0,
        source_id=b"fedcba9876543210",
        samples=(0.25, -0.5, 0.75, 1.0),
    )


def test_v2_audio_packet_round_trips() -> None:
    packet = v2_packet()
    encoded = encode_audio_packet_v2(packet)
    assert len(encoded) == AUDIO_HEADER_V2.size + 4 * 4
    assert parse_audio_packet_v2(encoded) == packet


def test_v1_and_v2_headers_carry_distinct_versions() -> None:
    v1 = encode_audio_packet(
        AudioPacket(
            session_id=b"0123456789abcdef",
            sequence=0,
            capture_monotonic_ns=0,
            sample_rate=16_000,
            channels=1,
            flags=0,
            samples=(0.0,),
        )
    )
    v2 = encode_audio_packet_v2(v2_packet())
    assert v1[4:6] == b"\x01\x00"
    assert v2[4:6] == b"\x02\x00"


def test_v1_decoder_rejects_v2_frames() -> None:
    with pytest.raises(ValueError, match="invalid audio header"):
        parse_audio_packet(encode_audio_packet_v2(v2_packet()))


def test_v2_decoder_rejects_v1_frames() -> None:
    v1 = encode_audio_packet(
        AudioPacket(
            session_id=b"0123456789abcdef",
            sequence=0,
            capture_monotonic_ns=0,
            sample_rate=16_000,
            channels=1,
            flags=0,
            samples=(0.0,),
        )
    )
    with pytest.raises(ValueError, match="invalid audio header"):
        parse_audio_packet_v2(v1)


def test_v2_packet_rejects_short_source_id() -> None:
    with pytest.raises(ValueError):
        AudioPacketV2(
            session_id=b"0123456789abcdef",
            sequence=0,
            capture_monotonic_ns=0,
            sample_rate=16_000,
            channels=1,
            flags=0,
            source_id=b"short",
            samples=(0.0,),
        )


def test_source_id_hex_conversion() -> None:
    raw = b"\x30\x31\x32\x33\x34\x35\x36\x37\x38\x39\x61\x62\x63\x64\x65\x66"
    assert encode_source_id_hex(raw) == "30313233343536373839616263646566"
    assert parse_source_id_hex("30313233343536373839616263646566") == raw
    with pytest.raises(ValueError, match="32 lowercase hex"):
        parse_source_id_hex("3031323334353637383961626364656G")
    with pytest.raises(ValueError, match="32 lowercase hex"):
        parse_source_id_hex("ABCD")
    with pytest.raises(ValueError, match="invalid source id bytes"):
        encode_source_id_hex(b"short")


def test_negotiate_protocol_version() -> None:
    assert negotiate_protocol_version([2, 1]) == PROTOCOL_V2
    assert negotiate_protocol_version([1]) == PROTOCOL_VERSION
    assert negotiate_protocol_version([2, 1], supported=(PROTOCOL_VERSION,)) == PROTOCOL_VERSION
    with pytest.raises(ValueError, match="no common"):
        negotiate_protocol_version([3])


def caption_v2() -> CaptionPayload:
    return CaptionPayload(
        caption_id="c-1",
        utterance_id="u-1",
        revision=3,
        status="provisional",
        source_mode="filipino",
        source_text="ilipat sa B",
        english_text="rotate to B",
        started_monotonic_ns=1,
        ended_monotonic_ns=None,
        capture_to_caption_ms=2.0,
        asr_ms=1.0,
        translation_ms=1.0,
        confidence=0.9,
        warnings=[],
        source_id="30313233343536373839616263646566",
        source_snapshot=SourceSnapshot(
            display_name="Valorant Team",
            caption_tag="TEAM",
            label_style="brackets",
            color="#7dd3fc",
        ),
        strictness="balanced",
        filter_applied="passed",
        filter_reason=None,
    )


def test_caption_v2_dump_round_trips() -> None:
    dumped = dump_caption(caption_v2(), include_v2=True)
    assert dumped["source_id"] == "30313233343536373839616263646566"
    assert dumped["source_snapshot"]["label_style"] == "brackets"
    assert dumped["strictness"] == "balanced"
    assert dumped["filter_applied"] == "passed"
    parsed = CaptionPayload.model_validate(dumped)
    assert parsed == caption_v2()


def test_caption_v1_dump_excludes_v2_fields() -> None:
    dumped = dump_caption(caption_v2(), include_v2=False)
    for key in ("source_id", "source_snapshot", "strictness", "filter_applied", "filter_reason"):
        assert key not in dumped
    assert CaptionPayload.model_validate(dumped).source_id is None


def test_caption_v1_json_without_v2_fields_parses() -> None:
    v1 = CaptionPayload.model_validate(
        {
            "caption_id": "c-1",
            "utterance_id": "u-1",
            "revision": 1,
            "status": "final",
            "source_mode": "filipino",
            "source_text": "a",
            "english_text": "b",
            "started_monotonic_ns": 1,
            "ended_monotonic_ns": 2,
            "capture_to_caption_ms": 1.0,
            "asr_ms": 1.0,
            "translation_ms": 1.0,
            "confidence": 0.5,
            "warnings": [],
        }
    )
    assert v1.source_id is None


def test_caption_rejects_unknown_label_style() -> None:
    dumped = dump_caption(caption_v2(), include_v2=True)
    dumped["source_snapshot"] = {
        "display_name": "x",
        "caption_tag": "X",
        "label_style": "matrix",
        "color": None,
    }
    with pytest.raises(ValueError):
        CaptionPayload.model_validate(dumped)


def test_caption_rejects_bad_source_id_format() -> None:
    dumped = dump_caption(caption_v2(), include_v2=True)
    dumped["source_id"] = "not-hex"
    with pytest.raises(ValueError):
        CaptionPayload.model_validate(dumped)
