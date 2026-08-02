from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import os
import queue
import threading
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
    AudioPacket,
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
    NemoCtcProvider,
    NllbCTranslate2Provider,
    TranslationProvider,
    provider_readiness,
)
from local_squad_inference.vad import AudioUtterance, vad_config_from_sensitivity

SendJson = Callable[[dict[str, object]], Awaitable[None]]

logger = logging.getLogger("local_squad_inference.sidecar")


def _configure_file_logging() -> None:
    """Persist sidecar diagnostics to a local file so mid-session failures
    are traceable. The desktop supervisor captures neither stdout nor stderr,
    so without this, a worker exception mid-session would be invisible."""
    local_app_data = os.environ.get("LOCALAPPDATA") or str(Path.home())
    log_dir = Path(local_app_data) / "xTRSNLTR"
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(
        log_dir / "sidecar.log",
        encoding="utf-8",
        delay=True,
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


_configure_file_logging()

# Provisional captions: do not decode before this much speech has accumulated,
# then decode once per cadence while the utterance stays open. Both are VAD
# thread clocks (monotonic).
PROVISIONAL_MIN_SPEECH_NS = 800_000_000
PROVISIONAL_CADENCE_NS = 600_000_000


@lru_cache(maxsize=4)
def local_translation_provider(target_language: str = "en") -> NllbCTranslate2Provider:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return NllbCTranslate2Provider(
        model_root / "nllb-200-distilled-600M-ct2-int8",
        target_language=target_language,
    )


@lru_cache(maxsize=1)
def madlad_translation_provider() -> MadladTranslationProvider:
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


NCSpeech_MODEL_DIRS: dict[str, str] = {
    "ncspeech": "ncspeech-tl-fastconformer-hybrid-large",
    "ncspeech-zh": "ncspeech-zh-citrinet-1024-gamma",
    "ncspeech-zh-parakeet": "ncspeech-zh-parakeet-ctc-0.6b",
}


@lru_cache(maxsize=2)
def local_ncspeech_provider(name: str) -> NemoCtcProvider:
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models")) / "artifacts"
    return NemoCtcProvider(model_root / NCSpeech_MODEL_DIRS[name])


def build_translation_provider(name: str, target_language: str = "en") -> TranslationProvider:
    """Return the configured translation provider. Defaults to local NLLB.

    NLLB-200-distilled-600M via CTranslate2 is the near-real-time default
    (tens of milliseconds on CUDA); target_language selects the output
    language ("en" -> English, "zh" -> simplified Chinese) and applies to the
    local NLLB provider and to the opt-in HTTP providers. The heavier MADLAD
    candle runner remains selectable.
    HTTP providers are opt-in: when selected, the recognized source transcript
    (text only — never raw audio) is sent over HTTP to the configured endpoint.
    """
    if name in {"nllb", "local", ""}:
        return local_translation_provider(target_language)
    if name in {"madlad"}:
        return madlad_translation_provider()
    if name in {"demo"}:
        return DemoTranslationProvider()
    factory = HTTP_PROVIDER_FACTORIES.get(name)
    if factory is None:
        raise HttpTranslationError(f"unknown HTTP translation provider: {name}")
    return factory(target_language=target_language)


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
    if name in {"ncspeech", "ncspeech-zh", "ncspeech-zh-parakeet"}:
        return local_ncspeech_provider(name)
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


class LivePipelineWorker:
    """Runs the pipeline so the websocket handler never blocks on inference.

    ASR + translation can take seconds per utterance (MADLAD is heavy), so
    the worker splits the pipeline in two:

    - one VAD thread consumes audio packets in real time (never falls
      behind, never drops speech, even while inference is busy);
    - a small inference pool runs ASR + translation for completed
      utterances, so captions pipeline instead of serializing.

    Overload is explicit: the packet queue is bounded latest-wins, and so
    is the utterance job queue — a slow inference drops the oldest pending
    work instead of stalling the audio path or the Rust capture.
    """

    def __init__(
        self,
        pipeline: LivePipeline,
        *,
        max_pending: int = 8,
        max_pending_utterances: int = 4,
        num_inference: int = 2,
    ) -> None:
        self._pipeline = pipeline
        self._input: queue.Queue[AudioPacket | None] = queue.Queue(maxsize=max_pending)
        self._jobs: queue.Queue[AudioUtterance | None] = queue.Queue(maxsize=max_pending_utterances)
        # Provisional decodes use a single latest-wins slot: a newer snapshot
        # of the same utterance supersedes an older pending one, and workers
        # drain this queue before the finals queue because provisionals are
        # cheap and time-sensitive.
        self._provisional: queue.Queue[AudioUtterance] = queue.Queue(maxsize=1)
        self._results: queue.Queue[tuple[CaptionPayload, ...] | Exception] = queue.Queue()
        self._dropped_packets = 0
        self._stopped = False
        self._thread = threading.Thread(
            target=self._run_vad,
            name="live-pipeline-vad",
            daemon=True,
        )
        self._workers = [
            threading.Thread(
                target=self._run_inference,
                name=f"live-pipeline-inference-{index}",
                daemon=True,
            )
            for index in range(max(1, num_inference))
        ]
        self._thread.start()
        for worker in self._workers:
            worker.start()

    def submit(self, packet: AudioPacket) -> None:
        # Latest-wins: when the VAD is behind, keep the most recent audio
        # (the speech that is happening right now) instead of the oldest.
        while True:
            try:
                self._input.put_nowait(packet)
                return
            except queue.Full:
                try:
                    self._input.get_nowait()
                except queue.Empty:
                    return
                self._dropped_packets += 1

    def poll(self) -> tuple[CaptionPayload, ...] | Exception | None:
        try:
            return self._results.get_nowait()
        except queue.Empty:
            return None

    def wait_next(self, timeout: float) -> tuple[CaptionPayload, ...] | Exception | None:
        try:
            return self._results.get(timeout=timeout)
        except queue.Empty:
            return None

    @property
    def stopped(self) -> bool:
        return self._stopped

    def stop(self) -> tuple[tuple[CaptionPayload, ...], int]:
        if self._stopped:
            return (), self._dropped_packets
        self._stopped = True
        while True:
            try:
                self._input.put_nowait(None)
                break
            except queue.Full:
                try:
                    self._input.get_nowait()
                except queue.Empty:
                    break
                self._dropped_packets += 1
        self._thread.join(timeout=10.0)
        for worker in self._workers:
            worker.join(timeout=10.0)
        captions: list[CaptionPayload] = []
        while True:
            try:
                result = self._results.get_nowait()
            except queue.Empty:
                break
            if not isinstance(result, Exception):
                # Final captions only: a pending provisional that never got a
                # final must not surface as a dangling "Listening" entry.
                captions.extend(
                    caption for caption in result if getattr(caption, "status", "final") == "final"
                )
        return tuple(captions), self._dropped_packets

    def _enqueue_utterance(self, utterance: AudioUtterance) -> None:
        while True:
            try:
                self._jobs.put_nowait(utterance)
                return
            except queue.Full:
                try:
                    self._jobs.get_nowait()
                except queue.Empty:
                    return
                self._pipeline.note_utterances_dropped(1)

    def _enqueue_provisional(self, utterance: AudioUtterance) -> None:
        # Latest-wins: keep the newest snapshot of the open utterance.
        while True:
            try:
                self._provisional.put_nowait(utterance)
                return
            except queue.Full:
                try:
                    self._provisional.get_nowait()
                except queue.Empty:
                    return

    def _run_vad(self) -> None:
        next_provisional_at_ns: int | None = None
        while True:
            packet = self._input.get()
            if packet is None:
                break
            try:
                utterances = self._pipeline.feed_utterances(packet)
            except Exception as error:  # surfaced to the client as live.error
                logger.exception("VAD feed failed: %s", error)
                self._results.put(error)
                continue
            for utterance in utterances:
                self._enqueue_utterance(utterance)
            try:
                snapshot = self._pipeline.provisional_utterance()
            except Exception as error:  # surfaced to the client as live.error
                logger.exception("VAD provisional snapshot failed: %s", error)
                self._results.put(error)
                continue
            now_ns = time.monotonic_ns()
            if snapshot is not None:
                speech_elapsed_ns = snapshot.ended_ns - snapshot.started_ns
                due = next_provisional_at_ns is None or now_ns >= next_provisional_at_ns
                if speech_elapsed_ns >= PROVISIONAL_MIN_SPEECH_NS and due:
                    self._enqueue_provisional(snapshot)
                    next_provisional_at_ns = now_ns + PROVISIONAL_CADENCE_NS
            else:
                next_provisional_at_ns = None
        try:
            utterances = self._pipeline.flush_utterances()
        except Exception as error:
            self._results.put(error)
            utterances = []
        for utterance in utterances:
            self._enqueue_utterance(utterance)
        for _ in self._workers:
            while True:
                try:
                    self._jobs.put(None, timeout=1.0)
                    break
                except queue.Full:
                    # Workers keep consuming jobs, so a slot always
                    # frees eventually; never drop a sentinel.
                    continue

    def _take_job(self) -> AudioUtterance | None:
        # Provisional snapshots arrive on a separate latest-wins queue, and a
        # worker parked in a blocking `_jobs.get()` would never see them, so
        # poll the provisional slot with a short timeout around each blocking
        # wait. The sentinel `None` is only ever placed in `_jobs`.
        while True:
            try:
                return self._provisional.get_nowait()
            except queue.Empty:
                pass
            try:
                job = self._jobs.get(timeout=0.05)
            except queue.Empty:
                continue
            return job

    def _run_inference(self) -> None:
        while True:
            job = self._take_job()
            if job is None:
                return
            try:
                captions = self._pipeline.infer_utterances([job])
                self._results.put(captions)
            except Exception as error:  # surfaced to the client as live.error
                logger.exception("live inference failed: %s", error)
                self._results.put(error)


async def drain_live_results(
    connection: ServerConnection,
    session_id: str,
    worker: LivePipelineWorker,
    send_lock: asyncio.Lock,
) -> None:
    """Delivers worker results as they arrive, without blocking the event loop.

    Captions are produced asynchronously on the worker thread (seconds after
    the audio that triggered them), so they must be drained independently of
    incoming messages — otherwise the first caption after a quiet period would
    sit in the queue forever.
    """
    sequence = 0
    finalized_ids: set[str] = set()
    while not worker.stopped:
        result = await asyncio.to_thread(worker.wait_next, 0.05)
        if result is None:
            continue
        if isinstance(result, Exception):
            sequence += 1
            async with send_lock:
                await connection.send(
                    json.dumps(
                        envelope(
                            "live.error",
                            f"live-error-{sequence}",
                            session_id,
                            {
                                "code": "LIVE_INFERENCE_FAILED",
                                "message": str(result),
                                "recoverable": True,
                            },
                        )
                    )
                )
            continue
        for _index, caption in enumerate(result, start=1):
            # A provisional that surfaces after its own final is stale (the
            # VAD cadence raced inference completion) — drop it so the client
            # never sees "Listening..." overwrite a delivered final.
            if caption.status == "provisional" and caption.caption_id in finalized_ids:
                continue
            if caption.status == "final":
                finalized_ids.add(caption.caption_id)
            sequence += 1
            async with send_lock:
                await connection.send(
                    json.dumps(
                        envelope(
                            f"caption.{caption.status}",
                            f"live-caption-{sequence}",
                            session_id,
                            caption.model_dump(mode="json"),
                        )
                    )
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
        live_worker: LivePipelineWorker | None = None
        drain_task: asyncio.Task[None] | None = None
        send_lock = asyncio.Lock()
        async for message in connection:
            if isinstance(message, bytes):
                packet = parse_audio_packet(message)
                if last_sequence is not None and packet.sequence <= last_sequence:
                    await connection.close(code=1008, reason="stale audio sequence")
                    return
                last_sequence = packet.sequence
                if live_worker is not None:
                    live_worker.submit(packet)
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
                            live_request.target_language,
                        )
                    live_pipeline = LivePipeline(
                        asr_provider,
                        translation_provider,
                        source_mode=live_request.source_mode,
                        vad_config=vad_config_from_sensitivity(live_request.vad_sensitivity),
                        use_silero=live_request.provider != "demo",
                    )
                    live_worker = LivePipelineWorker(live_pipeline)
                    drain_task = asyncio.create_task(
                        drain_live_results(
                            connection,
                            hello_envelope.session_id,
                            live_worker,
                            send_lock,
                        )
                    )
                except Exception as error:
                    logger.exception("live start failed: %s", error)
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
                                "target_language": live_request.target_language,
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
                captions: tuple[CaptionPayload, ...] = ()
                if live_worker is not None:
                    if drain_task is not None:
                        drain_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await drain_task
                        drain_task = None
                    captions, dropped_packets = live_worker.stop()
                    live_worker = None
                    metrics = (
                        asdict(live_pipeline.metrics)
                        if live_pipeline is not None
                        else {
                            "packets_received": 0,
                            "utterances_completed": 0,
                            "captions_emitted": 0,
                            "low_confidence_captions": 0,
                            "packets_dropped": 0,
                            "utterances_dropped": 0,
                        }
                    )
                    metrics["packets_dropped"] = dropped_packets
                    live_pipeline = None
                else:
                    metrics = {
                        "packets_received": 0,
                        "utterances_completed": 0,
                        "captions_emitted": 0,
                        "low_confidence_captions": 0,
                        "packets_dropped": 0,
                        "utterances_dropped": 0,
                    }
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
    finally:
        if drain_task is not None:
            drain_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await drain_task
        if live_worker is not None:
            live_worker.stop()


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
