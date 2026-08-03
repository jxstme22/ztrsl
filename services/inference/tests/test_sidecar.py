import asyncio
import json
import math
import time
import wave
from array import array
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosedError

from local_squad_inference.protocol import (
    AudioPacket,
    AudioPacketV2,
    encode_audio_packet,
    encode_audio_packet_v2,
)
from local_squad_inference.sidecar import LivePipelineWorker, handle_connection


async def with_server(
    test: Callable[[str, asyncio.Event], Awaitable[None]],
) -> None:
    stop_event = asyncio.Event()
    async with serve(
        lambda connection: handle_connection(connection, "launch-token", stop_event),
        "127.0.0.1",
        0,
        max_queue=16,
        compression=None,
    ) as server:
        socket = server.sockets[0]
        port = socket.getsockname()[1]
        await test(f"ws://127.0.0.1:{port}", stop_event)


def hello(token: str) -> str:
    return json.dumps(
        {
            "protocol_version": 1,
            "message_id": "hello-1",
            "session_id": "session-1",
            "type": "hello",
            "sent_monotonic_ns": 1,
            "payload": {
                "token": token,
                "desktop_version": "0.1.0",
                "protocol_versions": [1],
                "capabilities": ["pcm_f32le", "caption_revisions"],
            },
        }
    )


def test_invalid_token_is_rejected() -> None:
    async def scenario(url: str, _stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("wrong-token"))
            try:
                await websocket.recv()
                raise AssertionError("invalid token should close the connection")
            except ConnectionClosedError as error:
                assert error.rcvd is not None
                assert error.rcvd.code == 1008

    asyncio.run(with_server(scenario))


def test_fake_audio_produces_provisional_and_final_captions() -> None:
    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            accepted: dict[str, Any] = json.loads(await websocket.recv())
            assert accepted["type"] == "hello.accepted"

            packet = AudioPacket(
                session_id=b"0123456789abcdef",
                sequence=1,
                capture_monotonic_ns=100,
                sample_rate=16_000,
                channels=1,
                flags=0,
                samples=tuple([0.25] * 320),
            )
            await websocket.send(encode_audio_packet(packet))
            provisional: dict[str, Any] = json.loads(await websocket.recv())
            final: dict[str, Any] = json.loads(await websocket.recv())
            assert provisional["type"] == "caption.provisional"
            assert final["type"] == "caption.final"
            assert provisional["payload"]["caption_id"] == final["payload"]["caption_id"]
            assert provisional["payload"]["revision"] < final["payload"]["revision"]
            stop.set()

    asyncio.run(with_server(scenario))


def hello_v2(token: str) -> str:
    return json.dumps(
        {
            "protocol_version": 1,
            "message_id": "hello-1",
            "session_id": "session-v2",
            "type": "hello",
            "sent_monotonic_ns": 1,
            "payload": {
                "token": token,
                "desktop_version": "0.1.0",
                "protocol_versions": [2, 1],
                "capabilities": ["ipc_v2", "multi_source", "pcm_f32le", "caption_revisions"],
            },
        }
    )


TEAM_SOURCE = "11111111111111111111111111111111"
DISCORD_SOURCE = "22222222222222222222222222222222"


def control(message_id: str, message_type: str, payload: dict[str, Any]) -> str:
    return json.dumps(
        {
            "protocol_version": 2,
            "message_id": message_id,
            "session_id": "session-v2",
            "type": message_type,
            "sent_monotonic_ns": 2,
            "payload": payload,
        }
    )


def registry_payload() -> dict[str, Any]:
    return {
        "sources": [
            {
                "source_id": TEAM_SOURCE,
                "display_name": "Valorant Team",
                "caption_tag": "TEAM",
                "capture_target": {"kind": "endpoint", "endpoint_id": "team-capture"},
                "language_profile": "auto",
                "strictness": "balanced",
                "label_style": "brackets",
                "color": "#7dd3fc",
            },
            {
                "source_id": DISCORD_SOURCE,
                "display_name": "Discord Call",
                "caption_tag": "DISCORD",
                "capture_target": {"kind": "endpoint", "endpoint_id": "discord-capture"},
                "language_profile": "auto",
                "strictness": "off",
                "label_style": "brackets",
                "color": "#a5f3fc",
            },
        ]
    }


def v2_packet(sequence: int, source_id: bytes) -> AudioPacketV2:
    return AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=sequence,
        capture_monotonic_ns=sequence * 20_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        source_id=source_id,
        samples=tuple([0.25] * 320),
    )


def test_v2_multi_source_captions_are_independent_and_rename_isolated() -> None:
    """IPC v2 freeze §6: TEAM + DISCORD streams are independent, and a
    mid-session DISCORD rename never touches TEAM captions, ids, or
    revisions."""

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello_v2("launch-token"))
            accepted: dict[str, Any] = json.loads(await websocket.recv())
            assert accepted["type"] == "hello.accepted"
            assert accepted["payload"]["protocol_version"] == 2

            await websocket.send(control("registry-1", "source.registry", registry_payload()))
            assert json.loads(await websocket.recv())["type"] == "source.registry.accepted"

            async def roundtrip(sequence: int, source_id: str) -> dict[str, Any]:
                packet = v2_packet(sequence, bytes.fromhex(source_id))
                await websocket.send(encode_audio_packet_v2(packet))
                provisional: dict[str, Any] = json.loads(await websocket.recv())
                final: dict[str, Any] = json.loads(await websocket.recv())
                assert provisional["protocol_version"] == 2
                assert provisional["type"] == "caption.provisional"
                assert final["type"] == "caption.final"
                assert provisional["payload"]["caption_id"] == final["payload"]["caption_id"]
                return provisional["payload"]

            team = await roundtrip(1, TEAM_SOURCE)
            discord = await roundtrip(2, DISCORD_SOURCE)
            assert team["source_id"] == TEAM_SOURCE
            assert discord["source_id"] == DISCORD_SOURCE
            assert team["source_snapshot"]["caption_tag"] == "TEAM"
            assert discord["source_snapshot"]["caption_tag"] == "DISCORD"
            assert team["strictness"] == "balanced"
            assert discord["strictness"] == "off"
            assert team["filter_applied"] == "off"
            assert team["caption_id"] != discord["caption_id"]

            await websocket.send(
                control(
                    "presentation-1",
                    "source.presentation.update",
                    {
                        "source_id": DISCORD_SOURCE,
                        "source_snapshot": {
                            "display_name": "Discord (Renamed)",
                            "caption_tag": "DC2",
                            "label_style": "colon",
                            "color": "#a5f3fc",
                        },
                    },
                )
            )
            assert json.loads(await websocket.recv())["type"] == "source.presentation.accepted"

            team_after = await roundtrip(3, TEAM_SOURCE)
            discord_after = await roundtrip(4, DISCORD_SOURCE)
            assert team_after["source_snapshot"]["caption_tag"] == "TEAM"
            assert team_after["source_id"] == TEAM_SOURCE
            assert team_after["revision"] == team["revision"]
            assert discord_after["source_snapshot"]["caption_tag"] == "DC2"
            assert discord_after["source_id"] == DISCORD_SOURCE
            stop.set()

    asyncio.run(with_server(scenario))


def test_v2_session_rejects_v1_frames_with_protocol_mismatch() -> None:
    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello_v2("launch-token"))
            await websocket.recv()

            v1 = AudioPacket(
                session_id=b"0123456789abcdef",
                sequence=1,
                capture_monotonic_ns=100,
                sample_rate=16_000,
                channels=1,
                flags=0,
                samples=(0.25,) * 320,
            )
            await websocket.send(encode_audio_packet(v1))
            mismatch: dict[str, Any] = json.loads(await websocket.recv())
            assert mismatch["type"] == "error.protocol_mismatch"
            try:
                await websocket.recv()
                raise AssertionError("v1 frame in v2 session must close the connection")
            except ConnectionClosedError as error:
                assert error.rcvd is not None
                assert error.rcvd.code == 1008
            stop.set()

    asyncio.run(with_server(scenario))


def test_v2_presentation_update_for_unknown_source_errors() -> None:
    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello_v2("launch-token"))
            await websocket.recv()
            await websocket.send(control("registry-1", "source.registry", registry_payload()))
            await websocket.recv()

            await websocket.send(
                control(
                    "presentation-1",
                    "source.presentation.update",
                    {
                        "source_id": "99999999999999999999999999999999",
                        "source_snapshot": {
                            "display_name": "Ghost",
                            "caption_tag": "GHOST",
                            "label_style": "brackets",
                            "color": None,
                        },
                    },
                )
            )
            error: dict[str, Any] = json.loads(await websocket.recv())
            assert error["type"] == "source.presentation.error"
            assert error["payload"]["code"] == "unknown_source"
            stop.set()

    asyncio.run(with_server(scenario))


def test_worker_survives_slow_inference_with_bounded_drops() -> None:
    class SlowPipeline:
        def __init__(self) -> None:
            self.fed = 0
            self.dropped = 0

        def feed_utterances(self, _packet: AudioPacket) -> tuple[()]:
            self.fed += 1
            return ()

        def infer_utterances(self, utterances: list[object]) -> tuple[()]:
            return ()

        def flush_utterances(self) -> tuple[()]:
            return ()

        def flush(self) -> tuple[()]:
            return ()

        def note_utterances_dropped(self, count: int) -> None:
            self.dropped += count

    def packet(sequence: int) -> AudioPacket:
        return AudioPacket(
            session_id=b"0123456789abcdef",
            sequence=sequence,
            capture_monotonic_ns=sequence * 20_000_000,
            sample_rate=16_000,
            channels=1,
            flags=0,
            samples=(0.1,) * 5120,
        )

    pipeline = SlowPipeline()
    worker = LivePipelineWorker(pipeline, max_pending=2)  # type: ignore[arg-type]
    for sequence in range(1, 13):
        worker.submit(packet(sequence))
    time.sleep(0.3)
    captions, dropped = worker.stop()
    assert captions == ()
    assert pipeline.fed + dropped == 12
    assert dropped > 0


@dataclass
class FakeUtterance:
    sequence: int
    utterance_id: str
    source_id: str | None = None


def test_worker_delivers_results_in_order_and_never_blocks() -> None:
    class EmittingPipeline:
        def feed_utterances(self, packet: AudioPacket) -> list[FakeUtterance]:
            return [FakeUtterance(sequence=packet.sequence, utterance_id=str(packet.sequence))]

        def infer_utterances(self, utterances: list[FakeUtterance]) -> tuple[int, ...]:
            return tuple(utterance.sequence for utterance in utterances)

        def flush_utterances(self) -> list[tuple[int, ...]]:
            return []

        def flush(self) -> list[tuple[int, ...]]:
            return []

        def note_utterances_dropped(self, count: int) -> None:
            pass

        def provisional_utterance(self) -> None:
            return None

    worker = LivePipelineWorker(EmittingPipeline(), max_pending=4, num_inference=1)  # type: ignore[arg-type]
    for sequence in range(1, 4):
        worker.submit(
            AudioPacket(
                session_id=b"0123456789abcdef",
                sequence=sequence,
                capture_monotonic_ns=sequence * 20_000_000,
                sample_rate=16_000,
                channels=1,
                flags=0,
                samples=(0.1,) * 5120,
            )
        )
    results: list[object] = []
    deadline = time.monotonic() + 2.0
    while len(results) < 3 and time.monotonic() < deadline:
        result = worker.poll()
        if result is not None and not isinstance(result, Exception):
            results.extend(result)
        time.sleep(0.005)
    assert results == [1, 2, 3]
    worker.stop()


def test_worker_vad_stays_realtime_while_inference_is_slow() -> None:
    class SlowInferPipeline:
        def __init__(self) -> None:
            self.fed = 0
            self.inferred = 0

        def feed_utterances(self, packet: AudioPacket) -> list[FakeUtterance]:
            self.fed += 1
            return [FakeUtterance(sequence=packet.sequence, utterance_id=str(packet.sequence))]

        def infer_utterances(self, utterances: list[FakeUtterance]) -> tuple[tuple[int, ...], ...]:
            self.inferred += len(utterances)
            time.sleep(0.25)
            return tuple(utterances)

        def flush_utterances(self) -> list[tuple[int, ...]]:
            return []

        def flush(self) -> list[tuple[int, ...]]:
            return []

        def note_utterances_dropped(self, count: int) -> None:
            pass

        def provisional_utterance(self) -> None:
            return None

    pipeline = SlowInferPipeline()
    worker = LivePipelineWorker(pipeline, max_pending=8, num_inference=2)  # type: ignore[arg-type]
    for sequence in range(1, 7):
        worker.submit(
            AudioPacket(
                session_id=b"0123456789abcdef",
                sequence=sequence,
                capture_monotonic_ns=sequence * 20_000_000,
                sample_rate=16_000,
                channels=1,
                flags=0,
                samples=(0.1,) * 5120,
            )
        )
    deadline = time.monotonic() + 1.0
    while pipeline.fed < 6 and time.monotonic() < deadline:
        time.sleep(0.01)
    # The VAD thread consumes every packet immediately even though the
    # inference pool is still busy — the audio path never falls behind.
    assert pipeline.fed == 6
    assert pipeline.inferred <= 6
    worker.stop()


def test_live_demo_session_segments_audio_and_stops_with_metrics() -> None:
    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "live-start-1",
                        "session_id": "session-1",
                        "type": "live.start",
                        "sent_monotonic_ns": 2,
                        "payload": {
                            "source_mode": "filipino",
                            "target_language": "zh",
                            "provider": "demo",
                            "resource_profile": "quality",
                            "vad_sensitivity": 30,
                        },
                    }
                )
            )
            started: dict[str, Any] = json.loads(await websocket.recv())
            assert started["type"] == "live.started"
            assert started["payload"]["target_language"] == "zh"

            for sequence, amplitude in enumerate((0.1, 0.1, 0.0, 0.0, 0.0), start=1):
                packet = AudioPacket(
                    session_id=b"0123456789abcdef",
                    sequence=sequence,
                    capture_monotonic_ns=sequence * 300_000_000,
                    sample_rate=16_000,
                    channels=1,
                    flags=0,
                    samples=tuple([amplitude] * 4_800),
                )
                await websocket.send(encode_audio_packet(packet))

            # The utterance is long enough that provisional captions may
            # stream while speech is still open; any provisional seen must
            # share the final's caption_id and arrive before it.
            caption: dict[str, Any] = json.loads(await websocket.recv())
            assert caption["type"] in ("caption.provisional", "caption.final")
            final: dict[str, Any] = caption
            while final["type"] != "caption.final":
                final = json.loads(await websocket.recv())
                assert final["type"] in ("caption.provisional", "caption.final")
                assert final["payload"]["caption_id"] == caption["payload"]["caption_id"]
            assert final["payload"]["source_mode"] == "filipino"
            assert final["payload"]["status"] == "final"

            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "live-stop-1",
                        "session_id": "session-1",
                        "type": "live.stop",
                        "sent_monotonic_ns": 3,
                        "payload": {},
                    }
                )
            )
            stopped: dict[str, Any] = json.loads(await websocket.recv())
            assert stopped["type"] == "live.stopped"
            assert stopped["payload"]["metrics"]["captions_emitted"] == 1
            stop.set()

    asyncio.run(with_server(scenario))


def test_live_second_burst_still_detected_while_first_is_inferring() -> None:
    """Regression: the websocket handler used to block on inference inline,
    so the second utterance never reached the VAD (the user-visible bug:
    "first caption works, then nothing"). The VAD thread must keep
    consuming audio while inference is busy, and both bursts must produce
    captions in order."""

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "live-start-1",
                        "session_id": "session-1",
                        "type": "live.start",
                        "sent_monotonic_ns": 2,
                        "payload": {
                            "source_mode": "filipino",
                            "provider": "demo",
                            "resource_profile": "quality",
                            "vad_sensitivity": 30,
                        },
                    }
                )
            )
            started: dict[str, Any] = json.loads(await websocket.recv())
            assert started["type"] == "live.started"

            amplitudes = (
                # burst 1 (900 ms of speech)
                (0.1,) * 3
                + (0.0,) * 2  # pause (600 ms) > min_silence_ms
                + (0.1,) * 3  # burst 2
                + (0.0,) * 2  # trailing silence closes burst 2
            )
            for sequence, amplitude in enumerate(amplitudes, start=1):
                packet = AudioPacket(
                    session_id=b"0123456789abcdef",
                    sequence=sequence,
                    capture_monotonic_ns=sequence * 300_000_000,
                    sample_rate=16_000,
                    channels=1,
                    flags=0,
                    samples=tuple([amplitude] * 4_800),
                )
                await websocket.send(encode_audio_packet(packet))

            finals: list[dict[str, Any]] = []
            while len(finals) < 2:
                message = json.loads(await asyncio.wait_for(websocket.recv(), timeout=5.0))
                # Provisional captions stream while each burst is still
                # open; only the finals are collected here.
                assert message["type"] in ("caption.provisional", "caption.final")
                if message["type"] == "caption.final":
                    finals.append(message)

            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "live-stop-1",
                        "session_id": "session-1",
                        "type": "live.stop",
                        "sent_monotonic_ns": 3,
                        "payload": {},
                    }
                )
            )
            stopped: dict[str, Any] = json.loads(await websocket.recv())
            assert stopped["type"] == "live.stopped"
            assert stopped["payload"]["metrics"]["captions_emitted"] == 2
            assert finals[0]["payload"]["caption_id"] != finals[1]["payload"]["caption_id"]
            stop.set()

    asyncio.run(with_server(scenario))


def test_user_selected_wav_runs_through_clip_pipeline(tmp_path: Path) -> None:
    source = tmp_path / "friends-comms.wav"
    samples = array(
        "h",
        (
            int(12_000 * math.sin(2 * math.pi * 220 * index / 16_000))
            if 3_200 <= index < 8_000
            else 0
            for index in range(16_000)
        ),
    )
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(samples.tobytes())

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "clip-1",
                        "session_id": "session-1",
                        "type": "clip.process",
                        "sent_monotonic_ns": 2,
                        "payload": {
                            "path": str(source.resolve()),
                            "source_mode": "mixed",
                            "provider": "demo",
                        },
                    }
                )
            )
            completed: dict[str, Any] = json.loads(await websocket.recv())
            assert completed["type"] == "clip.completed"
            assert completed["payload"]["metadata"]["display_name"] == source.name
            assert len(completed["payload"]["captions"]) == 1
            assert completed["payload"]["mode"] == "demo"
            stop.set()

    asyncio.run(with_server(scenario))


def test_clip_compare_runs_multiple_configs_content_free(tmp_path: Path) -> None:
    """v0.4 Phase 1: clip.compare runs a file through several configs and, by
    default, returns no transcript content."""
    source = tmp_path / "compare.wav"
    samples = array(
        "h",
        (
            int(12_000 * math.sin(2 * math.pi * 220 * index / 16_000))
            if 3_200 <= index < 8_000
            else 0
            for index in range(16_000)
        ),
    )
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(samples.tobytes())

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "message_id": "clip-compare-1",
                        "session_id": "session-1",
                        "type": "clip.compare",
                        "sent_monotonic_ns": 2,
                        "payload": {
                            "path": str(source.resolve()),
                            "source_mode": "mixed",
                            "configs": [["demo", "demo"]],
                        },
                    }
                )
            )
            completed: dict[str, Any] = json.loads(await websocket.recv())
            assert completed["type"] == "clip.compare.completed"
            payload = completed["payload"]
            assert payload["app_version"] == "0.4.0-dev"
            assert len(payload["runs"]) == 1
            run = payload["runs"][0]
            assert run["asr_name"] == "demo"
            assert run["caption_count"] >= 1
            assert run["model_id"] == "demo+demo"
            # Default report is content-free: no transcript text.
            assert run["captions"] == []
            stop.set()

    asyncio.run(with_server(scenario))


def speech_packet_v2(sequence: int, source_id: str, amplitude: float) -> AudioPacketV2:
    """4800 samples (300 ms at 16 kHz) of speech-shaped or silent audio for
    a v2 live session. Sequence numbers are per-session, so callers must
    keep them globally increasing across sources."""
    return AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=sequence,
        capture_monotonic_ns=sequence * 300_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        source_id=bytes.fromhex(source_id),
        samples=tuple([amplitude] * 4_800),
    )


def test_v2_live_two_sources_keep_independent_utterances_and_rename_does_not_split() -> None:
    """Phase 5 acceptance: two sources speaking simultaneously produce
    independent utterances, and a mid-utterance rename neither resets nor
    splits the in-flight utterance."""

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello_v2("launch-token"))
            accepted: dict[str, Any] = json.loads(await websocket.recv())
            assert accepted["payload"]["protocol_version"] == 2
            await websocket.send(control("registry-1", "source.registry", registry_payload()))
            assert json.loads(await websocket.recv())["type"] == "source.registry.accepted"

            await websocket.send(
                control(
                    "live-start-1",
                    "live.start",
                    {
                        "source_mode": "filipino",
                        "target_language": "en",
                        "provider": "demo",
                        "resource_profile": "quality",
                        "vad_sensitivity": 50,
                    },
                )
            )
            assert json.loads(await websocket.recv())["type"] == "live.started"

            # Both sources open an utterance simultaneously.
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(1, TEAM_SOURCE, 0.25)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(2, DISCORD_SOURCE, 0.25)))
            # Rename TEAM while its utterance is still open.
            await websocket.send(
                control(
                    "presentation-1",
                    "source.presentation.update",
                    {
                        "source_id": TEAM_SOURCE,
                        "source_snapshot": {
                            "display_name": "Team (Renamed)",
                            "caption_tag": "TM2",
                            "label_style": "colon",
                            "color": "#7dd3fc",
                        },
                    },
                )
            )
            assert json.loads(await websocket.recv())["type"] == "source.presentation.accepted"
            # Close both utterances with silence.
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(3, TEAM_SOURCE, 0.0)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(4, DISCORD_SOURCE, 0.0)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(5, TEAM_SOURCE, 0.0)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(6, DISCORD_SOURCE, 0.0)))

            finals: dict[str, dict[str, Any]] = {}
            while len(finals) < 2:
                message: dict[str, Any] = json.loads(await websocket.recv())
                assert message["type"] in ("caption.provisional", "caption.final")
                if message["type"] == "caption.final":
                    payload = message["payload"]
                    assert payload["source_id"] is not None
                    finals[payload["source_id"]] = payload
            assert set(finals) == {TEAM_SOURCE, DISCORD_SOURCE}
            # The rename landed mid-utterance: exactly one final per source,
            # and TEAM's final already carries the new tag.
            assert finals[TEAM_SOURCE]["source_snapshot"]["caption_tag"] == "TM2"
            assert finals[DISCORD_SOURCE]["source_snapshot"]["caption_tag"] == "DISCORD"
            assert finals[TEAM_SOURCE]["caption_id"] != finals[DISCORD_SOURCE]["caption_id"]
            assert finals[TEAM_SOURCE]["source_mode"] == "filipino"
            # Phase 7: the language gate stamps filter fields per source.
            # TEAM is balanced -> demo caption (confidence None) classified
            # passed; DISCORD is off -> the gate reports "off".
            assert finals[TEAM_SOURCE]["strictness"] == "balanced"
            assert finals[TEAM_SOURCE]["filter_applied"] in ("passed", "off")
            assert finals[DISCORD_SOURCE]["strictness"] == "off"
            assert finals[DISCORD_SOURCE]["filter_applied"] == "off"

            # Per-source diagnostics: both sessions are active and have
            # completed exactly one utterance.
            await websocket.send(
                control("diag-1", "source.diagnostics.request", {"source_id": TEAM_SOURCE})
            )
            team_diag: dict[str, Any] = json.loads(await websocket.recv())
            assert team_diag["type"] == "source.diagnostics"
            assert team_diag["payload"]["active"] is True
            assert team_diag["payload"]["utterances_completed"] == 1
            # Phase 7: language-gate counters surface in diagnostics.
            team_filter = team_diag["payload"]["filter"]
            assert team_filter["applied"] >= 1
            await websocket.send(
                control("diag-2", "source.diagnostics.request", {"source_id": DISCORD_SOURCE})
            )
            discord_diag: dict[str, Any] = json.loads(await websocket.recv())
            assert discord_diag["payload"]["active"] is True
            assert discord_diag["payload"]["utterances_completed"] == 1

            # Stop TEAM: only its state is flushed away; DISCORD keeps
            # working, and a TEAM restart creates a fresh session.
            await websocket.send(control("stop-1", "source.stop", {"source_id": TEAM_SOURCE}))
            stopped: dict[str, Any] = json.loads(await websocket.recv())
            assert stopped["type"] == "source.stopped"
            assert stopped["payload"]["metrics"]["utterances_completed"] == 1
            await websocket.send(
                control("diag-3", "source.diagnostics.request", {"source_id": TEAM_SOURCE})
            )
            stopped_diag: dict[str, Any] = json.loads(await websocket.recv())
            assert stopped_diag["payload"]["active"] is False
            assert stopped_diag["payload"]["utterances_completed"] == 1

            # DISCORD still captures after TEAM stopped.
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(7, DISCORD_SOURCE, 0.25)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(8, DISCORD_SOURCE, 0.0)))
            await websocket.send(encode_audio_packet_v2(speech_packet_v2(9, DISCORD_SOURCE, 0.0)))
            discord_after: dict[str, Any] = json.loads(await websocket.recv())
            while discord_after["type"] != "caption.final":
                discord_after = json.loads(await websocket.recv())
            assert discord_after["payload"]["source_id"] == DISCORD_SOURCE

            await websocket.send(control("live-stop-1", "live.stop", {}))
            while True:
                message = json.loads(await websocket.recv())
                if message["type"] == "live.stopped":
                    break
            stop.set()

    asyncio.run(with_server(scenario))


def test_model_artifact_dir_resolves_both_layouts(tmp_path: Path) -> None:
    """v0.3 regression: in-app (Rust) downloads live at LST_MODEL_DIR/<id>,
    CLI downloads at LST_MODEL_DIR/artifacts/<id>. Both must resolve."""
    import os

    from local_squad_inference.sidecar import _model_artifact_dir

    # Clear the lru cache so env changes are picked up.
    _model_artifact_dir.cache_clear()

    rust_layout = tmp_path / "rust"
    (rust_layout / "whisper-large-v3-turbo").mkdir(parents=True)
    cli_layout = tmp_path / "cli"
    (cli_layout / "artifacts" / "nllb-200-distilled-600M-ct2-int8").mkdir(parents=True)

    os.environ["LST_MODEL_DIR"] = str(rust_layout)
    assert _model_artifact_dir("whisper-large-v3-turbo") == (rust_layout / "whisper-large-v3-turbo")

    os.environ["LST_MODEL_DIR"] = str(cli_layout)
    assert _model_artifact_dir("nllb-200-distilled-600M-ct2-int8") == (
        cli_layout / "artifacts" / "nllb-200-distilled-600M-ct2-int8"
    )

    # Missing model falls back to the artifacts path (gives a clean error).
    os.environ["LST_MODEL_DIR"] = str(rust_layout)
    assert _model_artifact_dir("missing-model") == (rust_layout / "artifacts" / "missing-model")
    _model_artifact_dir.cache_clear()
