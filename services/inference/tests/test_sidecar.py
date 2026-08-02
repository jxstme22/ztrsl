import asyncio
import json
import math
import time
import wave
from array import array
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosedError

from local_squad_inference.protocol import AudioPacket, encode_audio_packet
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
    worker = LivePipelineWorker(pipeline, max_pending=2)
    for sequence in range(1, 13):
        worker.submit(packet(sequence))
    time.sleep(0.3)
    captions, dropped = worker.stop()
    assert captions == ()
    assert pipeline.fed + dropped == 12
    assert dropped > 0


def test_worker_delivers_results_in_order_and_never_blocks() -> None:
    class EmittingPipeline:
        def feed_utterances(self, packet: AudioPacket) -> list[tuple[int]]:
            return [(packet.sequence,)]

        def infer_utterances(self, utterances: list[tuple[int]]) -> tuple[int]:
            return tuple(utterance[0] for utterance in utterances)

        def flush_utterances(self) -> list[()]:
            return []

        def flush(self) -> list[()]:
            return []

        def note_utterances_dropped(self, count: int) -> None:
            pass

        def provisional_utterance(self) -> None:
            return None

    worker = LivePipelineWorker(EmittingPipeline(), max_pending=4, num_inference=1)
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
    results: list[int] = []
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

        def feed_utterances(self, packet: AudioPacket) -> list[tuple[int]]:
            self.fed += 1
            return [(packet.sequence,)]

        def infer_utterances(self, utterances: list[tuple[int]]) -> tuple[tuple[int]]:
            self.inferred += len(utterances)
            time.sleep(0.25)
            return tuple(utterances)

        def flush_utterances(self) -> list[()]:
            return []

        def flush(self) -> list[()]:
            return []

        def note_utterances_dropped(self, count: int) -> None:
            pass

        def provisional_utterance(self) -> None:
            return None

    pipeline = SlowInferPipeline()
    worker = LivePipelineWorker(pipeline, max_pending=8, num_inference=2)
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
                            "provider": "demo",
                            "resource_profile": "quality",
                            "vad_sensitivity": 30,
                        },
                    }
                )
            )
            started: dict[str, Any] = json.loads(await websocket.recv())
            assert started["type"] == "live.started"

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
                message = json.loads(
                    await asyncio.wait_for(websocket.recv(), timeout=5.0)
                )
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
