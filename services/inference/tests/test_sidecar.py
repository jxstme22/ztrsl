import asyncio
import json
import math
import wave
from array import array
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosedError

from local_squad_inference.protocol import AudioPacket, encode_audio_packet
from local_squad_inference.sidecar import handle_connection


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
