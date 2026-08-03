import asyncio
import json
import threading
from collections.abc import Awaitable, Callable
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from local_squad_inference.protocol import AudioPacket, encode_audio_packet
from local_squad_inference.sidecar import handle_connection


def _fake_groq() -> tuple[str, Callable[[], dict[str, Any]]]:
    """Start a fake Groq transcription endpoint and return url + capture."""
    captured: dict[str, Any] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            captured["auth"] = self.headers.get("Authorization", "")
            captured["body_len"] = len(raw)
            captured["has_wav"] = b"RIFF" in raw
            captured["has_model"] = b"whisper-large-v3-turbo" in raw
            captured["has_tl"] = b"\r\ntl\r\n" in raw
            body = json.dumps({"text": "Kumusta ka na?"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: Any) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/transcriptions"

    def snapshot() -> dict[str, Any]:
        return dict(captured)

    return url, snapshot


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


def _live_start(**overrides: str) -> str:
    payload: dict[str, str] = {
        "source_mode": "filipino",
        "provider": "http",
        "asr_provider": "groq-whisper",
        "translation_provider": "demo",
        "resource_profile": "quality",
    }
    payload.update(overrides)
    return json.dumps(
        {
            "protocol_version": 1,
            "message_id": "live-start-1",
            "session_id": "session-1",
            "type": "live.start",
            "sent_monotonic_ns": 2,
            "payload": payload,
        }
    )


def test_groq_live_session_produces_caption(
    monkeypatch: Any,
) -> None:
    import local_squad_inference.http_asr as http_asr

    url, snapshot = _fake_groq()
    from local_squad_inference.http_asr import GroqConfig as _RealGroqConfig

    real_config = _RealGroqConfig

    def fake_config(*args: Any, **kwargs: Any) -> Any:
        return real_config(endpoint=url, timeout_s=5.0)

    monkeypatch.setenv("LST_GROQ_API_KEY", "gsk_test")
    monkeypatch.setattr(http_asr, "GroqConfig", fake_config)

    import local_squad_inference.sidecar as sidecar_mod
    from local_squad_inference.live import LivePipeline as RealLivePipeline

    def no_silero_pipeline(
        asr: Any,
        translation: Any,
        **kwargs: Any,
    ) -> Any:
        kwargs["use_silero"] = False
        return RealLivePipeline(asr, translation, **kwargs)

    monkeypatch.setattr(sidecar_mod, "LivePipeline", no_silero_pipeline)

    async def scenario(url: str, stop: asyncio.Event) -> None:
        async with connect(url) as websocket:
            await websocket.send(hello("launch-token"))
            await asyncio.wait_for(websocket.recv(), timeout=5)
            await websocket.send(_live_start())
            started: dict[str, Any] = json.loads(
                await asyncio.wait_for(websocket.recv(), timeout=5)
            )
            if started["type"] != "live.started":
                raise AssertionError(
                    f"expected live.started, got {started['type']}: {json.dumps(started)[:300]}"
                )
            assert started["type"] == "live.started"

            for sequence, amplitude in enumerate((0.3, 0.3, 0.3, 0.0, 0.0, 0.0), start=1):
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

            # A 900 ms utterance crosses the provisional threshold, so a
            # provisional caption may stream first; collect until the final
            # arrives (same convention as the other live-session tests).
            caption: dict[str, Any] | None = None
            while caption is None:
                message: dict[str, Any] = json.loads(
                    await asyncio.wait_for(websocket.recv(), timeout=5)
                )
                if message["type"] == "caption.final":
                    caption = message
            assert caption["payload"]["english_text"] != ""
            stop.set()

    async def run() -> None:
        await _serve(scenario)

    asyncio.run(run())
    assert snapshot()["has_wav"] is True
    assert snapshot()["has_model"] is True
    assert snapshot()["has_tl"] is True
    assert snapshot()["auth"] == "Bearer gsk_test"


async def _serve(
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
