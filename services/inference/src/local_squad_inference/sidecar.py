from __future__ import annotations

import asyncio
import hmac
import json
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

from pydantic import ValidationError
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from local_squad_inference.clip import process_clip
from local_squad_inference.protocol import (
    MAX_AUDIO_MESSAGE_BYTES,
    MAX_CONTROL_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    CaptionPayload,
    ClipProcessPayload,
    ControlEnvelope,
    HelloPayload,
    parse_audio_packet,
)
from local_squad_inference.providers import (
    MadladTranslationProvider,
    ModelUnavailableError,
    SherpaOmnilingualProvider,
    provider_readiness,
)

SendJson = Callable[[dict[str, object]], Awaitable[None]]


@lru_cache(maxsize=1)
def local_providers() -> tuple[SherpaOmnilingualProvider, MadladTranslationProvider]:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return (
        SherpaOmnilingualProvider(model_root / "omni-ctc-300m-int8"),
        MadladTranslationProvider(model_root / "madlad400-3b-mt"),
    )


def envelope(
    message_type: str,
    message_id: str,
    session_id: str,
    payload: dict[str, object],
) -> dict[str, object]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "message_id": message_id,
        "session_id": session_id,
        "type": message_type,
        "sent_monotonic_ns": time.monotonic_ns(),
        "payload": payload,
    }


def fake_captions(session_id: str, sequence: int, started_ns: int) -> tuple[CaptionPayload, ...]:
    caption_id = f"fake-{session_id}-{sequence}"
    return (
        CaptionPayload(
            caption_id=caption_id,
            utterance_id=f"utterance-{sequence}",
            revision=1,
            status="provisional",
            source_mode="cebuano",
            source_text="Adto ta sa B, naa na sila sa A.",
            english_text="Let's rotate to B…",
            started_monotonic_ns=started_ns,
            ended_monotonic_ns=None,
            capture_to_caption_ms=18.0,
            asr_ms=4.0,
            translation_ms=2.0,
            confidence=None,
            warnings=[],
        ),
        CaptionPayload(
            caption_id=caption_id,
            utterance_id=f"utterance-{sequence}",
            revision=2,
            status="final",
            source_mode="cebuano",
            source_text="Adto ta sa B, naa na sila sa A.",
            english_text="Let's rotate to B—they're already on A.",
            started_monotonic_ns=started_ns,
            ended_monotonic_ns=started_ns + 20_000_000,
            capture_to_caption_ms=18.0,
            asr_ms=4.0,
            translation_ms=2.0,
            confidence=None,
            warnings=[],
        ),
    )


def is_loopback_peer(connection: ServerConnection) -> bool:
    peer = connection.remote_address
    if not isinstance(peer, tuple) or not peer:
        return False
    return str(peer[0]) in {"127.0.0.1", "::1"}


async def handle_connection(
    connection: ServerConnection,
    expected_token: str,
    stop_event: asyncio.Event,
) -> None:
    if not is_loopback_peer(connection):
        await connection.close(code=1008, reason="loopback required")
        return
    try:
        first = await asyncio.wait_for(connection.recv(), timeout=3)
        if not isinstance(first, str) or len(first.encode()) > MAX_CONTROL_MESSAGE_BYTES:
            await connection.close(code=1009, reason="invalid hello")
            return
        hello_envelope = ControlEnvelope.model_validate_json(first)
        hello = HelloPayload.model_validate(hello_envelope.payload)
        if (
            hello_envelope.type != "hello"
            or not hmac.compare_digest(hello.token, expected_token)
            or PROTOCOL_VERSION not in hello.protocol_versions
        ):
            await connection.close(code=1008, reason="authentication failed")
            return

        await connection.send(
            json.dumps(
                envelope(
                    "hello.accepted",
                    "hello-accepted",
                    hello_envelope.session_id,
                    {
                        "protocol_version": PROTOCOL_VERSION,
                        "sidecar_version": "0.1.0",
                        "models": {
                            "vad": "fake-vad",
                            "asr": "fake-asr",
                            "translation": "fake-mt",
                        },
                    },
                )
            )
        )

        last_sequence: int | None = None
        async for message in connection:
            if isinstance(message, bytes):
                packet = parse_audio_packet(message)
                if last_sequence is not None and packet.sequence <= last_sequence:
                    await connection.close(code=1008, reason="stale audio sequence")
                    return
                last_sequence = packet.sequence
                for index, caption in enumerate(
                    fake_captions(
                        hello_envelope.session_id,
                        packet.sequence,
                        packet.capture_monotonic_ns,
                    ),
                    start=1,
                ):
                    await connection.send(
                        json.dumps(
                            envelope(
                                f"caption.{caption.status}",
                                f"caption-{packet.sequence}-{index}",
                                hello_envelope.session_id,
                                caption.model_dump(mode="json"),
                            )
                        )
                    )
                continue

            if len(message.encode()) > MAX_CONTROL_MESSAGE_BYTES:
                await connection.close(code=1009, reason="control message too large")
                return
            control = ControlEnvelope.model_validate_json(message)
            if control.type == "hello":
                await connection.close(code=1008, reason="already authenticated")
                return
            if control.type == "health.request":
                await connection.send(
                    json.dumps(
                        envelope(
                            "health",
                            "health-response",
                            control.session_id,
                            {
                                "state": "ready",
                                "models_loaded": False,
                                "provider": "fake",
                            },
                        )
                    )
                )
            elif control.type == "shutdown":
                await connection.send(
                    json.dumps(
                        envelope(
                            "shutdown.accepted",
                            "shutdown-response",
                            control.session_id,
                            {},
                        )
                    )
                )
                stop_event.set()
                return
            elif control.type == "models.status.request":
                model_root = Path(os.environ.get("LST_MODEL_DIR", "models"))
                await connection.send(
                    json.dumps(
                        envelope(
                            "models.status",
                            control.message_id,
                            control.session_id,
                            {"providers": provider_readiness(model_root)},
                        )
                    )
                )
            elif control.type == "clip.process":
                request = ClipProcessPayload.model_validate(control.payload)
                try:
                    kwargs: dict[str, object] = {"mode": request.provider}
                    if request.provider == "local":
                        asr_provider, translation_provider = local_providers()
                        kwargs.update(
                            {
                                "asr": asr_provider,
                                "translation": translation_provider,
                            }
                        )
                    result = await asyncio.to_thread(
                        process_clip,
                        Path(request.path),
                        request.source_mode,
                        **kwargs,
                    )
                except (OSError, RuntimeError, ValueError, ModelUnavailableError) as error:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "clip.error",
                                control.message_id,
                                control.session_id,
                                {
                                    "code": "CLIP_PROCESSING_FAILED",
                                    "message": str(error),
                                },
                            )
                        )
                    )
                    continue
                await connection.send(
                    json.dumps(
                        envelope(
                            "clip.completed",
                            control.message_id,
                            control.session_id,
                            {
                                "metadata": asdict(result.metadata),
                                "captions": [asdict(caption) for caption in result.captions],
                                "truncated": result.truncated,
                                "mode": result.mode,
                            },
                        )
                    )
                )
    except (TimeoutError, ConnectionClosed, ValidationError, ValueError):
        if connection.state.name != "CLOSED":
            await connection.close(code=1008, reason="invalid message")


async def run_server(port: int, token: str) -> None:
    stop_event = asyncio.Event()
    async with serve(
        lambda connection: handle_connection(connection, token, stop_event),
        "127.0.0.1",
        port,
        max_size=max(MAX_CONTROL_MESSAGE_BYTES, MAX_AUDIO_MESSAGE_BYTES),
        max_queue=16,
        compression=None,
    ):
        await stop_event.wait()


def main() -> None:
    port = int(os.environ["LST_IPC_PORT"])
    token = os.environ["LST_IPC_TOKEN"]
    if not token:
        raise SystemExit("LST_IPC_TOKEN must not be empty")
    asyncio.run(run_server(port, token))


if __name__ == "__main__":
    main()
