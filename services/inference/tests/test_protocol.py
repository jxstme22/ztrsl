import pytest

from local_squad_inference.protocol import AudioPacket, encode_audio_packet, parse_audio_packet


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
