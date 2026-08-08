"""DS-902: local caption stream for consumers (OBS browser sources, etc.).

Opt-in via `LST_CAPTION_STREAM_PORT`. A bounded, localhost-only HTTP SSE
endpoint broadcasts final/provisional captions as JSON. No raw audio, no
authentication secrets, bounded client count.
"""

from __future__ import annotations

import asyncio
import json
import os

MAX_STREAM_CLIENTS = 4
SSE_KEEPALIVE_S = 15


class CaptionStreamHub:
    def __init__(self, max_clients: int = MAX_STREAM_CLIENTS) -> None:
        self._clients: set[asyncio.Queue[str]] = set()
        self._max_clients = max_clients

    async def publish(self, caption: dict[str, object]) -> None:
        payload = f"data: {json.dumps(caption, ensure_ascii=False)}\n\n"
        stale: list[asyncio.Queue[str]] = []
        for client in list(self._clients):
            try:
                client.put_nowait(payload)
            except asyncio.QueueFull:
                stale.append(client)
        for client in stale:
            self._clients.discard(client)

    def client_count(self) -> int:
        return len(self._clients)

    def accepts(self) -> bool:
        return len(self._clients) < self._max_clients

    async def register(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
        self._clients.add(queue)
        return queue

    def unregister(self, queue: asyncio.Queue[str]) -> None:
        self._clients.discard(queue)


def caption_stream_enabled() -> bool:
    return bool(os.environ.get("LST_CAPTION_STREAM_PORT", "").strip())


async def run_caption_stream(port: int, hub: CaptionStreamHub) -> None:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if not hub.accepts():
            writer.close()
            return
        queue = await hub.register()
        try:
            response_head = (
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                b"Cache-Control: no-cache\r\n\r\n"
            )
            writer.write(response_head)
            await writer.drain()
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_S)
                    writer.write(payload.encode("utf-8"))
                    await writer.drain()
                except TimeoutError:
                    writer.write(b": keepalive\n\n")
                    await writer.drain()
                except (ConnectionResetError, BrokenPipeError):
                    break
        finally:
            hub.unregister(queue)
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", port)
    async with server:
        await server.serve_forever()
