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
from local_squad_inference.http_asr import GroqWhisperProvider, HttpAsrError
from local_squad_inference.http_translation import (
    HTTP_PROVIDER_FACTORIES,
    HttpTranslationError,
)
from local_squad_inference.live import LivePipeline
from local_squad_inference.protocol import (
    MAX_AUDIO_MESSAGE_BYTES,
    MAX_CONTROL_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    CaptionPayload,
    ClipProcessPayload,
    ControlEnvelope,
    HelloPayload,
    LiveStartPayload,
    parse_audio_packet,
)
from local_squad_inference.providers import (
    AsrProvider,
    DemoAsrProvider,
    DemoTranslationProvider,
    FasterWhisperProvider,
    MadladTranslationProvider,
    NemoCtcTagalogProvider,
    TranslationProvider,
    provider_readiness,
)
from local_squad_inference.vad import vad_config_from_sensitivity

SendJson = Callable[[dict[str, object]], Awaitable[None]]


@lru_cache(maxsize=1)
def local_translation_provider() -> MadladTranslationProvider:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return MadladTranslationProvider(model_root / "madlad400-3b-mt")


def _whisper_model_dir(model_root: Path, requested_model_id: str) -> Path:
    model_dir = model_root / requested_model_id
    if model_dir.is_dir():
        return model_dir
    # Fall back to whichever Whisper variant is present when the requested
    # model is unavailable. Turbo is lighter and faster; large-v3 is the
    # full-capacity fallback for users who already downloaded it.
    for candidate in ("whisper-large-v3-turbo", "whisper-large-v3"):
        fallback = model_root / candidate
        if fallback.is_dir():
            return fallback
    return model_dir


@lru_cache(maxsize=4)
def local_whisper_provider(requested_model_id: str) -> FasterWhisperProvider:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return FasterWhisperProvider(_whisper_model_dir(model_root, requested_model_id))


@lru_cache(maxsize=1)
def local_ncspeech_provider() -> NemoCtcTagalogProvider:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return NemoCtcTagalogProvider(model_root / "ncspeech-tl-fastconformer-hybrid-large")


def build_translation_provider(name: str) -> TranslationProvider:
    """Return the configured translation provider. Defaults to local MADLAD.

    HTTP providers are opt-in: when selected, the recognized source transcript
    (text only — never raw audio) is sent over HTTP to the configured endpoint.
    """
    if name in {"madlad", "local", ""}:
        return local_translation_provider()
    if name in {"demo"}:
        return DemoTranslationProvider()
    factory = HTTP_PROVIDER_FACTORIES.get(name)
    if factory is None:
        raise HttpTranslationError(f"unknown HTTP translation provider: {name}")
    return factory()


def build_asr_provider(name: str) -> AsrProvider:
    """Return the configured ASR provider. Defaults to local faster-whisper.

    Local variants pick the installed Whisper artifact or the NCSpeech CTC
    export; remote ASR (Groq) is opt-in and uploads each completed utterance's
    audio to Groq's Whisper endpoint. A missing API key raises before the
    session starts so misconfiguration is visible.
    """
    if name in {"", "local", "whisper-turbo"}:
        requested = os.environ.get("LST_WHISPER_MODEL_ID", "whisper-large-v3-turbo")
        if name == "whisper-turbo":
            requested = "whisper-large-v3-turbo"
        return local_whisper_provider(requested)
    if name == "whisper-full":
        return local_whisper_provider("whisper-large-v3")
    if name == "ncspeech":
        return local_ncspeech_provider()
    if name == "groq-whisper":
        return GroqWhisperProvider()
    if name in {"demo"}:
        return DemoAsrProvider()
    raise HttpAsrError(f"unknown ASR provider: {name}")


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
        live_pipeline: LivePipeline | None = None
        async for message in connection:
            if isinstance(message, bytes):
                packet = parse_audio_packet(message)
                if last_sequence is not None and packet.sequence <= last_sequence:
                    await connection.close(code=1008, reason="stale audio sequence")
                    return
                last_sequence = packet.sequence
                if live_pipeline is not None:
                    try:
                        captions = await asyncio.to_thread(live_pipeline.feed, packet)
                    except Exception as error:
                        await connection.send(
                            json.dumps(
                                envelope(
                                    "live.error",
                                    f"live-error-{packet.sequence}",
                                    hello_envelope.session_id,
                                    {
                                        "code": "LIVE_INFERENCE_FAILED",
                                        "message": str(error),
                                        "recoverable": True,
                                    },
                                )
                            )
                        )
                        continue
                    for index, caption in enumerate(captions, start=1):
                        await connection.send(
                            json.dumps(
                                envelope(
                                    f"caption.{caption.status}",
                                    f"live-caption-{packet.sequence}-{index}",
                                    hello_envelope.session_id,
                                    caption.model_dump(mode="json"),
                                )
                            )
                        )
                    continue
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
            elif control.type == "live.start":
                live_request = LiveStartPayload.model_validate(control.payload)
                try:
                    asr_provider: AsrProvider
                    translation_provider: TranslationProvider
                    if live_request.provider == "demo":
                        asr_provider = DemoAsrProvider()
                        translation_provider = DemoTranslationProvider()
                    else:
                        asr_provider = await asyncio.to_thread(
                            build_asr_provider,
                            live_request.asr_provider,
                        )
                        translation_provider = await asyncio.to_thread(
                            build_translation_provider,
                            live_request.translation_provider,
                        )
                    live_pipeline = LivePipeline(
                        asr_provider,
                        translation_provider,
                        source_mode=live_request.source_mode,
                        vad_config=vad_config_from_sensitivity(
                            live_request.vad_sensitivity
                        ),
                        use_silero=live_request.provider != "demo",
                    )
                except Exception as error:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "live.error",
                                control.message_id,
                                control.session_id,
                                {
                                    "code": "LIVE_START_FAILED",
                                    "message": str(error),
                                    "recoverable": True,
                                },
                            )
                        )
                    )
                    continue
                await connection.send(
                    json.dumps(
                        envelope(
                            "live.started",
                            control.message_id,
                            control.session_id,
                            {
                                "source_mode": live_request.source_mode,
                                "provider": live_request.provider,
                                "resource_profile": live_request.resource_profile,
                                "asr_model": getattr(asr_provider, "model_id", "demo-asr"),
                                "audio_format": {
                                    "sample_rate": 16_000,
                                    "channels": 1,
                                },
                            },
                        )
                    )
                )
            elif control.type == "live.stop":
                if live_pipeline is not None:
                    try:
                        captions = await asyncio.to_thread(live_pipeline.flush)
                    except Exception:
                        captions = ()
                    for index, caption in enumerate(captions, start=1):
                        await connection.send(
                            json.dumps(
                                envelope(
                                    f"caption.{caption.status}",
                                    f"live-final-{index}",
                                    control.session_id,
                                    caption.model_dump(mode="json"),
                                )
                            )
                        )
                    metrics = asdict(live_pipeline.metrics)
                    live_pipeline = None
                else:
                    metrics = {
                        "packets_received": 0,
                        "utterances_completed": 0,
                        "captions_emitted": 0,
                        "low_confidence_captions": 0,
                    }
                await connection.send(
                    json.dumps(
                        envelope(
                            "live.stopped",
                            control.message_id,
                            control.session_id,
                            {"metrics": metrics},
                        )
                    )
                )
            elif control.type == "clip.process":
                clip_request = ClipProcessPayload.model_validate(control.payload)
                try:
                    if clip_request.provider == "local":
                        asr_provider = local_whisper_provider(
                            os.environ.get("LST_WHISPER_MODEL_ID", "whisper-large-v3-turbo")
                        )
                        translation_provider = local_translation_provider()
                        result = await asyncio.to_thread(
                            process_clip,
                            Path(clip_request.path),
                            clip_request.source_mode,
                            file_asr=asr_provider,
                            translation=translation_provider,
                            mode="local",
                        )
                    else:
                        result = await asyncio.to_thread(
                            process_clip,
                            Path(clip_request.path),
                            clip_request.source_mode,
                            mode="demo",
                        )
                except Exception as error:
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
