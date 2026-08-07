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
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict

from pydantic import ValidationError
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from local_squad_inference.clip import process_clip
from local_squad_inference.evaluation.accuracy_lab import KNOWN_CONFIGS, compare_clips
from local_squad_inference.http_asr import GroqWhisperProvider, HttpAsrError, NvidiaAsrProvider
from local_squad_inference.http_translation import (
    HTTP_PROVIDER_FACTORIES,
    HttpTranslationError,
    NvidiaRivaProvider,
)
from local_squad_inference.live import LivePipeline, LivePipelineMetrics, source_key_of
from local_squad_inference.overlap import (
    MINIMUM_OVERLAP_MS,
    OverlapPolicy,
    OverlapSample,
    OverlapStatus,
    classify_overlap,
)
from local_squad_inference.profiles import FilterApplied, GateDecision, apply_language_gate
from local_squad_inference.protocol import (
    AUDIO_HEADER_V2,
    MAX_AUDIO_MESSAGE_BYTES,
    MAX_CONTROL_MESSAGE_BYTES,
    PROTOCOL_V2,
    PROTOCOL_VERSION,
    AudioPacket,
    AudioPacketV2,
    CaptionCertainty,
    CaptionPayload,
    ClipComparePayload,
    ClipProcessPayload,
    ControlEnvelope,
    HelloPayload,
    LiveStartPayload,
    SourceControlPayload,
    SourcePresentationUpdatePayload,
    SourceRegistryEntry,
    SourceRegistryPayload,
    SourceSnapshot,
    Strictness,
    SuppressionReason,
    UncertaintyReason,
    dump_caption,
    encode_source_id_hex,
    negotiate_protocol_version,
    parse_audio_packet,
    parse_audio_packet_v2,
)
from local_squad_inference.providers import (
    AsrProvider,
    DemoAsrProvider,
    DemoTranslationProvider,
    FasterWhisperProvider,
    MadladTranslationProvider,
    MlxWhisperProvider,
    NemoCtcProvider,
    NllbCTranslate2Provider,
    TranslationProvider,
    provider_readiness,
)
from local_squad_inference.scheduler import (
    DEFAULT_SOURCE_PRIORITY,
    InferenceScheduler,
    SchedulerMetrics,
    make_job,
)
from local_squad_inference.vad import AudioUtterance, vad_config_from_sensitivity

SendJson = Callable[[dict[str, object]], Awaitable[None]]

logger = logging.getLogger("local_squad_inference.sidecar")


def profile_source_mode(
    language_profile: str,
) -> Literal["filipino", "chinese", "english", "indonesian", "vietnamese", "thai", "malay"]:
    """Map a registry language profile to the ASR source mode. Only Chinese
    diverges today; Filipino-family profiles (filipino/tagalog/cebuano) all
    use the Filipino ASR mode. Per-source strictness and filters land in a
    later phase."""
    if language_profile == "chinese":
        return "chinese"
    return "filipino"


def _priority_of_source(
    source_key: str | None,
    source_registry: dict[str, SourceRegistryEntry],
) -> int:
    """Scheduler priority for a source (spec §7.2). Derived from the
    immutable source id and the registry's explicit priority — never from
    display names or tags, so renames cannot change scheduling."""
    if source_key is None:
        return DEFAULT_SOURCE_PRIORITY
    entry = source_registry.get(source_key)
    return entry.priority if entry is not None else DEFAULT_SOURCE_PRIORITY


def _language_profile_of_source(
    source_key: str | None,
    source_registry: dict[str, SourceRegistryEntry],
) -> str:
    if source_key is None:
        return "auto"
    entry = source_registry.get(source_key)
    return entry.language_profile if entry is not None else "auto"


@dataclass
class _FilterStats:
    applied: int = 0
    suppressed: int = 0
    flagged: int = 0
    passed: int = 0
    off: int = 0

    def reconcile(self, applied: FilterApplied) -> None:
        self.applied += 1
        if applied == "suppressed":
            self.suppressed += 1
        elif applied == "flagged":
            self.flagged += 1
        elif applied == "passed":
            self.passed += 1
        else:
            self.off += 1


# Per-source language-gate counters (Phase 7; surface in Phase 10). Guarded:
# the drain task and the control handler can touch these from different
# threads.
_filter_stats: dict[str, _FilterStats] = {}
_filter_stats_lock = threading.Lock()


def filter_stats_for(source_id: str) -> _FilterStats:
    with _filter_stats_lock:
        return _filter_stats.setdefault(source_id, _FilterStats())


def stamp_v2_caption(
    caption: CaptionPayload,
    source_registry: dict[str, SourceRegistryEntry],
    source_snapshots: dict[str, SourceSnapshot],
    overlap_status: Callable[[str], OverlapStatus] | None = None,
) -> CaptionPayload:
    """Return a copy of the caption with the registry presentation
    snapshot, strictness, language-gate result, and v0.4 certainty attached.
    Unknown sources keep the caption's own fields (unchanged copy)."""
    if caption.source_id is None:
        return caption
    entry = source_registry.get(caption.source_id)
    if entry is None:
        return caption
    # The gate classifies on the signals the caption actually carries
    # (confidence, timing); detected language is not yet threaded onto
    # captions, so mismatch classification is exercised by the gate's unit
    # tests and available to a future provider that reports it.
    duration_ms = None
    if caption.ended_monotonic_ns is not None and caption.started_monotonic_ns is not None:
        duration_ms = (caption.ended_monotonic_ns - caption.started_monotonic_ns) / 1e6
    decided = apply_language_gate(
        entry.language_profile,
        entry.strictness,
        source_text=caption.source_text,
        confidence=caption.confidence,
        utterance_duration_ms=duration_ms,
    )
    filter_stats_for(entry.source_id).reconcile(decided.applied)
    certainty = _certainty_for(caption, decided, overlap_status)
    return caption.model_copy(
        update={
            "source_snapshot": source_snapshots.get(entry.source_id) or entry_snapshot(entry),
            "strictness": entry.strictness,
            "filter_applied": decided.applied,
            "filter_reason": decided.reason,
            "certainty": certainty,
        }
    )


class _OverlapTracker:
    """v0.4 Phase 6: per-source overlap detection fed by the VAD thread.

    A single source's VAD stream cannot segment two simultaneous speakers, but
    overlapping speakers show up as *rapid turn-taking*: an utterance closes
    and the next opens with little or no silence gap (spec §5). The tracker
    records each utterance span per source and, when a new utterance opens
    within `MINIMUM_OVERLAP_MS` of the previous close, marks both as
    overlapping. `classify_overlap` then applies the per-source policy so the
    certainty pipeline can suppress or mark uncertain.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._spans: dict[str, list[tuple[int, int]]] = {}
        self._policy: dict[str, OverlapPolicy] = {}

    def set_policy(self, source_id: str, policy: OverlapPolicy) -> None:
        with self._lock:
            self._policy[source_id] = policy

    def note_utterance(self, source_id: str, started_ms: int, ended_ms: int) -> None:
        """Record a completed utterance span (ms). Rapid follow-up marks the
        pair as overlapping."""
        if source_id is None:
            return
        with self._lock:
            spans = self._spans.setdefault(source_id, [])
            spans.append((started_ms, ended_ms))
            # Keep only the recent window so stale activity stops counting.
            if len(spans) > 16:
                del spans[: len(spans) - 16]

    def status_for(self, source_id: str) -> OverlapStatus:
        """OverlapStatus for a source (policy applied). Defaults to
        `process_normally` so no policy ever blocks a source by accident."""
        with self._lock:
            spans = list(self._spans.get(source_id, []))
            policy = self._policy.get(source_id, "process_normally")
        samples: list[OverlapSample] = []
        # A span that began within MINIMUM_OVERLAP_MS of its predecessor ending
        # is treated as overlapping that predecessor.
        previous_end: int | None = None
        for started_ms, ended_ms in spans:
            if previous_end is not None and started_ms - previous_end < MINIMUM_OVERLAP_MS:
                # Overlap window: from previous start to current end.
                prev_start = samples[-1].start_ms if samples else started_ms
                samples[-1] = OverlapSample(speech=True, start_ms=prev_start, end_ms=ended_ms)
                samples.append(OverlapSample(speech=True, start_ms=started_ms, end_ms=ended_ms))
            else:
                samples.append(OverlapSample(speech=True, start_ms=started_ms, end_ms=ended_ms))
            previous_end = ended_ms
        return classify_overlap(samples, policy)


def _suppression_reason(reason: str | None) -> SuppressionReason:
    """Map a language-gate reason onto the v0.4 suppression-reason vocabulary."""
    if reason in {
        "heavy_overlap",
        "low_confidence",
        "unexpected_language",
        "phrase_filter",
        "clipping",
    }:
        return reason  # type: ignore[return-value]
    if reason in {"language_mismatch", "low_confidence_short"}:
        return "low_confidence"
    return "low_confidence"


def _make_stamp(
    source_registry: dict[str, SourceRegistryEntry],
    source_snapshots: dict[str, SourceSnapshot],
    live_worker: LivePipelineWorker | None,
) -> Callable[[CaptionPayload], CaptionPayload]:
    """Build the v2 caption-stamping callable for a live session, binding the
    per-source overlap lookup. Returns identity when no worker is present."""

    def stamp(caption: CaptionPayload) -> CaptionPayload:
        return stamp_v2_caption(
            caption,
            source_registry,
            source_snapshots,
            overlap_status=(live_worker._overlap.status_for if live_worker is not None else None),
        )

    return stamp


def _certainty_for(
    caption: CaptionPayload,
    decided: GateDecision,
    overlap_status: Callable[[str], OverlapStatus] | None,
) -> CaptionCertainty | None:
    """v0.4 certainty (BUILD_PLAN_V0_4 §4). Builds a certainty state from the
    language-gate outcome and the per-source overlap verdict. Final captions
    remain terminal; suppressed content is delivered (never flashed) so the
    overlay can show why."""
    source_id = caption.source_id
    if source_id is None:
        return None
    if decided.applied == "suppressed":
        return CaptionCertainty(
            state="suppressed",
            uncertainty_reasons=[],
            suppression_reason=_suppression_reason(decided.reason),
        )
    reasons: list[UncertaintyReason] = []
    if decided.applied == "flagged":
        reasons.append("unexpected_language")
    if caption.confidence is not None and caption.confidence < 0.3:
        reasons.append("low_asr_confidence")
    if overlap_status is not None:
        status = overlap_status(source_id)
        verdict = status.verdict
        if verdict == "suppressed":
            return CaptionCertainty(
                state="suppressed",
                uncertainty_reasons=[],
                suppression_reason="heavy_overlap",
            )
        if verdict == "uncertain":
            reasons.append("overlapping_speech")
    if not reasons:
        return None
    return CaptionCertainty(state="uncertain", uncertainty_reasons=reasons, suppression_reason=None)


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

# "final-only" mode (LST_CAPTION_MODE=final-only): wait for the speaker to
# finish and translate the whole utterance chunk — provisional captions are
# never emitted. Default "streaming" keeps the live preview cadence.
FINAL_ONLY_MODE = os.environ.get("LST_CAPTION_MODE", "streaming") == "final-only"


@lru_cache(maxsize=64)
def _model_artifact_dir(model_id: str) -> Path:
    """Resolve a model artifact directory for `model_id`.

    Two layouts are supported so both install paths work:
    - the CLI/scripts convention: `LST_MODEL_DIR/artifacts/<id>`; and
    - the in-app Rust installer: `LST_MODEL_DIR/<id>` (no `artifacts` nesting).

    The sidecar must accept either, otherwise models downloaded through the
    app are reported as "manifest missing or invalid" on live start.
    """
    model_root = Path(os.environ.get("LST_MODEL_DIR", "models"))
    for candidate in (model_root / "artifacts" / model_id, model_root / model_id):
        if candidate.is_dir():
            return candidate
    return model_root / "artifacts" / model_id


@lru_cache(maxsize=4)
def local_translation_provider(target_language: str = "en") -> NllbCTranslate2Provider:
    return NllbCTranslate2Provider(
        _model_artifact_dir("nllb-200-distilled-600M-ct2-int8"),
        target_language=target_language,
    )


@lru_cache(maxsize=1)
def madlad_translation_provider() -> MadladTranslationProvider:
    return MadladTranslationProvider(_model_artifact_dir("madlad400-3b-mt"))


def _whisper_model_dir(requested_model_id: str) -> Path:
    model_dir = _model_artifact_dir(requested_model_id)
    if model_dir.is_dir():
        return model_dir
    # Fall back to whichever Whisper variant is present when the requested
    # model is unavailable. Turbo is lighter and faster; large-v3 is the
    # full-capacity fallback for users who already downloaded it.
    for candidate in ("whisper-large-v3-turbo", "whisper-large-v3"):
        fallback = _model_artifact_dir(candidate)
        if fallback.is_dir():
            return fallback
    return model_dir


@lru_cache(maxsize=4)
def local_whisper_provider(requested_model_id: str) -> FasterWhisperProvider:
    return FasterWhisperProvider(_whisper_model_dir(requested_model_id))


@lru_cache(maxsize=2)
def local_mlx_whisper_provider(
    requested_model_id: str = "mlx-whisper-large-v3-turbo-q4",
) -> MlxWhisperProvider:
    return MlxWhisperProvider(_model_artifact_dir(requested_model_id))


NCSpeech_MODEL_DIRS: dict[str, str] = {
    "ncspeech": "ncspeech-tl-fastconformer-hybrid-large",
    "ncspeech-zh": "ncspeech-zh-citrinet-1024-gamma",
    "ncspeech-zh-parakeet": "ncspeech-zh-parakeet-ctc-0.6b",
}


@lru_cache(maxsize=2)
def local_ncspeech_provider(name: str) -> NemoCtcProvider:
    return NemoCtcProvider(_model_artifact_dir(NCSpeech_MODEL_DIRS[name]))


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
    if name in {"nvidia-riva-4b", "nvidia-riva-1.6b"}:
        return NvidiaRivaProvider(name, target_language=target_language)
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

    On Apple Silicon (macOS), `mlx` / `mlx-whisper` selects the Metal-accelerated
    mlx-whisper provider; `whisper-turbo`/`whisper-full` still pick the
    CTranslate2 build (CPU-only on macOS) for users who installed those weights.
    """
    if name in {"mlx", "mlx-whisper"}:
        requested = os.environ.get("LST_MLX_WHISPER_MODEL_ID", "mlx-whisper-large-v3-turbo-q4")
        return local_mlx_whisper_provider(requested)
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
    if name.startswith("nvidia-"):
        return NvidiaAsrProvider(name)
    if name in {"demo"}:
        return DemoAsrProvider()
    raise HttpAsrError(f"unknown ASR provider: {name}")


def envelope(
    message_type: str,
    message_id: str,
    session_id: str,
    payload: dict[str, object],
    version: int = PROTOCOL_VERSION,
) -> dict[str, object]:
    return {
        "protocol_version": version,
        "message_id": message_id,
        "session_id": session_id,
        "type": message_type,
        "sent_monotonic_ns": time.monotonic_ns(),
        "payload": payload,
    }


def entry_snapshot(entry: SourceRegistryEntry) -> SourceSnapshot:
    return SourceSnapshot(
        display_name=entry.display_name,
        caption_tag=entry.caption_tag,
        label_style=entry.label_style,
        color=entry.color,
    )


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


_DEFAULT_FAKE_SNAPSHOT = SourceSnapshot(
    display_name="Fake Source",
    caption_tag="SRC",
    label_style="brackets",
    color=None,
)


class _FakeCaptionV2Fields(TypedDict):
    caption_id: str
    utterance_id: str
    source_mode: Literal["cebuano"]
    source_text: str
    started_monotonic_ns: int
    capture_to_caption_ms: float
    asr_ms: float
    translation_ms: float
    confidence: None
    warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]]
    source_id: str
    source_snapshot: SourceSnapshot
    strictness: Literal["off", "balanced", "strict"]
    filter_applied: Literal["off", "suppressed", "flagged", "passed"]
    filter_reason: None


def fake_captions_v2(
    session_id: str,
    sequence: int,
    started_ns: int,
    source_id: bytes,
    snapshot: SourceSnapshot | None,
    strictness: Strictness | None,
) -> tuple[CaptionPayload, ...]:
    """v2 fake captions: same text as v1 but stamped with the immutable
    source id and the presentation snapshot (registry-backed or default)."""
    caption_id = f"fake-{session_id}-{sequence}"
    common: _FakeCaptionV2Fields = {
        "caption_id": caption_id,
        "utterance_id": f"utterance-{sequence}",
        "source_mode": "cebuano",
        "source_text": "Adto ta sa B, naa na sila sa A.",
        "started_monotonic_ns": started_ns,
        "capture_to_caption_ms": 18.0,
        "asr_ms": 4.0,
        "translation_ms": 2.0,
        "confidence": None,
        "warnings": [],
        "source_id": encode_source_id_hex(source_id),
        "source_snapshot": snapshot or _DEFAULT_FAKE_SNAPSHOT,
        "strictness": strictness or "off",
        "filter_applied": "off",
        "filter_reason": None,
    }
    return (
        CaptionPayload(
            **common,
            revision=1,
            status="provisional",
            english_text="Let's rotate to B…",
            ended_monotonic_ns=None,
        ),
        CaptionPayload(
            **common,
            revision=2,
            status="final",
            english_text="Let's rotate to B—they're already on A.",
            ended_monotonic_ns=started_ns + 20_000_000,
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

    Overload is explicit: the packet queue is bounded latest-wins, and
    completed utterances flow through one shared bounded priority
    scheduler (spec §7) — finals always beat provisionals and are never
    dropped silently, provisional revisions coalesce latest-wins, and
    overload surfaces via `scheduler.overloaded`.
    """

    def __init__(
        self,
        pipeline: LivePipeline,
        *,
        max_pending: int = 8,
        max_pending_utterances: int = 4,
        num_inference: int = 2,
        priority_of: Callable[[str | None], int] | None = None,
        language_profile_of: Callable[[str | None], str] | None = None,
    ) -> None:
        self._pipeline = pipeline
        self._input: queue.Queue[AudioPacket | object | None] = queue.Queue(maxsize=max_pending)
        # One shared scheduler for every source's decode work: models are
        # loaded once per process (shared VRAM), and scheduling keys on the
        # immutable source id plus a per-source priority — never on editable
        # names or tags.
        self._scheduler = InferenceScheduler(max_queued=max_pending_utterances)
        self._priority_of = priority_of or (lambda source_id: DEFAULT_SOURCE_PRIORITY)
        self._language_profile_of = language_profile_of or (lambda source_id: "auto")
        # Monotonic per-(source, utterance) revision counter for provisional
        # coalescing: the newest snapshot supersedes older queued ones.
        self._provisional_revisions: dict[tuple[str | None, str], int] = {}
        # v0.4 Phase 6: per-source overlap tracking, fed on the VAD thread.
        self._overlap = _OverlapTracker()
        self._overlap_policy_of: Callable[[str | None], OverlapPolicy] = lambda source_id: (
            "mark_uncertain"
        )
        # Per-source controls (flush/stop) are executed on the VAD thread:
        # the utterance managers are not thread-safe, and every manager is
        # touched only from the VAD thread. The control handler blocks on
        # the event until the VAD thread has finished the flush, then runs
        # inference on its own thread (providers are concurrency-safe).
        self._control: queue.Queue[tuple[str, str, threading.Event, dict[str, object]]] = (
            queue.Queue()
        )
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

    def submit(self, packet: AudioPacket | AudioPacketV2) -> None:
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

    def flush_source(self, source_id: str, *, timeout: float = 10.0) -> tuple[CaptionPayload, ...]:
        """Flush one source's open utterance on the VAD thread and infer it.
        The source's VAD state is kept, so speech continues the session."""
        utterances = self._run_source_control("flush", source_id, timeout)
        return self._pipeline.infer_utterances(utterances)

    def stop_source(
        self,
        source_id: str,
        *,
        timeout: float = 10.0,
    ) -> tuple[tuple[CaptionPayload, ...], LivePipelineMetrics]:
        """Flush one source and drop its VAD state on the VAD thread. Only
        that source is affected; a later packet restarts it fresh."""
        utterances = self._run_source_control("stop", source_id, timeout)
        captions = self._pipeline.infer_utterances(utterances)
        return captions, self._pipeline.metrics_for(source_id)

    def source_diagnostics(self, source_id: str) -> dict[str, object]:
        return self._pipeline.diagnostics_for(source_id)

    def scheduler_metrics(self) -> SchedulerMetrics:
        return self._scheduler.metrics()

    def scheduler_overload_events(self) -> int:
        return self._scheduler.overload_events()

    def _run_source_control(
        self,
        operation: str,
        source_id: str,
        timeout: float,
    ) -> list[AudioUtterance]:
        """Run a per-source VAD operation on the VAD thread and wait for the
        result. Unknown sources yield an empty list without error, so the
        controls are idempotent no-ops when a source was never started."""
        event = threading.Event()
        result: dict[str, object] = {}
        self._control.put((operation, source_id, event, result))
        if not event.wait(timeout=timeout):
            raise TimeoutError(f"{operation} for source {source_id} timed out")
        utterances = result.get("utterances")
        if utterances is None:
            return []
        assert isinstance(utterances, list)
        return utterances

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
        # Do NOT close the scheduler here: the VAD thread's shutdown flush
        # still enqueues trailing utterances, and closing first would drop
        # them. `_run_vad` closes the scheduler after its final flush, which
        # then wakes the workers to exit.
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
        # Final jobs are never dropped silently: the scheduler evicts stale
        # provisionals (and only as a counted last resort, the oldest final)
        # instead of refusing the work.
        self._scheduler.submit(
            make_job(
                utterance,
                is_final=True,
                revision=0,
                priority=self._priority_of(utterance.source_id),
                language_profile_id=self._language_profile_of(utterance.source_id),
            )
        )

    def _enqueue_provisional(self, utterance: AudioUtterance) -> None:
        # Latest-wins per (source, utterance): a newer snapshot supersedes
        # an older queued one; at high water the scheduler pauses secondary
        # provisional decoding and counts the refusal.
        key = (utterance.source_id, utterance.utterance_id)
        revision = self._provisional_revisions.get(key, 0) + 1
        self._provisional_revisions[key] = revision
        self._scheduler.submit(
            make_job(
                utterance,
                is_final=False,
                revision=revision,
                priority=self._priority_of(utterance.source_id),
                language_profile_id=self._language_profile_of(utterance.source_id),
            )
        )

    def _run_vad(self) -> None:
        next_provisional_at_ns: dict[str | None, int | None] = {}
        while True:
            try:
                packet = self._input.get(timeout=0.05)
            except queue.Empty:
                # Idle: keep draining per-source controls so a source.stop
                # is honored even when no audio is arriving.
                self._drain_controls()
                continue
            self._drain_controls()
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
                # v0.4 Phase 6: record the utterance span on the VAD thread so
                # rapid back-to-back speakers are flagged as overlap.
                if utterance.source_id is not None:
                    now_ms = int(time.monotonic() * 1000)
                    duration_ms = (utterance.ended_ns - utterance.started_ns) // 1_000_000
                    self._overlap.note_utterance(utterance.source_id, now_ms - duration_ms, now_ms)
            source_key = source_key_of(packet)
            try:
                snapshot = self._pipeline.provisional_utterance(source_key)
            except Exception as error:  # surfaced to the client as live.error
                logger.exception("VAD provisional snapshot failed: %s", error)
                self._results.put(error)
                continue
            now_ns = time.monotonic_ns()
            if snapshot is not None and not FINAL_ONLY_MODE:
                speech_elapsed_ns = snapshot.ended_ns - snapshot.started_ns
                due_ns = next_provisional_at_ns.get(source_key)
                due = due_ns is None or now_ns >= due_ns
                if speech_elapsed_ns >= PROVISIONAL_MIN_SPEECH_NS and due:
                    self._enqueue_provisional(snapshot)
                    next_provisional_at_ns[source_key] = now_ns + PROVISIONAL_CADENCE_NS
            else:
                next_provisional_at_ns[source_key] = None
        self._drain_controls()
        try:
            utterances = self._pipeline.flush_all_utterances()
        except Exception as error:
            self._results.put(error)
            utterances = []
        for utterance in utterances:
            self._enqueue_utterance(utterance)
        self._scheduler.close()

    def _drain_controls(self) -> None:
        while True:
            try:
                operation, source_id, event, result = self._control.get_nowait()
            except queue.Empty:
                return
            try:
                if operation == "flush":
                    result["utterances"] = self._pipeline.flush_source_utterances(source_id)
                elif operation == "stop":
                    result["utterances"] = self._pipeline.stop_source_utterances(source_id)
            except Exception as error:  # surfaced to the control caller
                result["error"] = error
            finally:
                event.set()

    def _take_job(self) -> AudioUtterance | None:
        job = self._scheduler.take(timeout=0.05)
        return job.utterance if job is not None else None

    def _run_inference(self) -> None:
        # Poll until the scheduler is closed: `take` returns None both on
        # timeout (idle) and after close, so the pool must exit on `closed`,
        # not on a single None — otherwise workers vanish on the first idle
        # period and later finals would wait forever.
        while not self._scheduler.closed:
            job = self._take_job()
            if job is None:
                continue
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
    version: int = PROTOCOL_VERSION,
    stamp: Callable[[CaptionPayload], CaptionPayload] | None = None,
) -> None:
    """Delivers worker results as they arrive, without blocking the event loop.

    Captions are produced asynchronously on the worker thread (seconds after
    the audio that triggered them), so they must be drained independently of
    incoming messages — otherwise the first caption after a quiet period would
    sit in the queue forever.

    `stamp` (v2 sessions) attaches the registry-backed presentation snapshot
    and strictness to each caption before it goes on the wire, so live
    captions stay source-correct even after mid-session renames.
    """
    sequence = 0
    finalized_ids: set[str] = set()
    overload_events = 0
    while not worker.stopped:
        # Overload is pushed, not polled: any new scheduler overload event
        # (provisional refusal, evicted final) is reported immediately.
        current_overloads = await asyncio.to_thread(worker.scheduler_overload_events)
        if current_overloads > overload_events:
            overload_events = current_overloads
            metrics = await asyncio.to_thread(worker.scheduler_metrics)
            logger.warning(
                "scheduler overload: events=%s provisionals_dropped=%s finals_dropped=%s depth=%s",
                metrics.overload_events,
                metrics.provisionals_dropped,
                metrics.finals_dropped,
                metrics.queue_depth,
            )
            if version < 2:
                # v1 is a legacy audio-only protocol with no control plane:
                # a scheduler.overloaded push would corrupt its caption
                # stream. Scheduling behavior is identical; only the
                # diagnostic event is withheld.
                continue
            async with send_lock:
                await connection.send(
                    json.dumps(
                        envelope(
                            "scheduler.overloaded",
                            f"scheduler-overloaded-{overload_events}",
                            session_id,
                            {
                                "overload_events": metrics.overload_events,
                                "provisionals_dropped": metrics.provisionals_dropped,
                                "finals_dropped": metrics.finals_dropped,
                                "queue_depth": metrics.queue_depth,
                            },
                            version=version,
                        )
                    )
                )
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
                            version=version,
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
            if stamp is not None:
                caption = stamp(caption)
            sequence += 1
            async with send_lock:
                await connection.send(
                    json.dumps(
                        envelope(
                            f"caption.{caption.status}",
                            f"live-caption-{sequence}",
                            session_id,
                            dump_caption(caption, include_v2=version >= PROTOCOL_V2),
                            version=version,
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
        try:
            negotiated_version = negotiate_protocol_version(hello.protocol_versions)
        except ValueError:
            await connection.close(code=1008, reason="authentication failed")
            return
        if hello_envelope.type != "hello" or not hmac.compare_digest(hello.token, expected_token):
            await connection.close(code=1008, reason="authentication failed")
            return

        await connection.send(
            json.dumps(
                envelope(
                    "hello.accepted",
                    "hello-accepted",
                    hello_envelope.session_id,
                    {
                        "protocol_version": negotiated_version,
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

        # v2 session state: registry pushed by the desktop after hello, and
        # the presentation snapshots the sidecar stamps onto captions.
        source_registry: dict[str, SourceRegistryEntry] = {}
        source_snapshots: dict[str, SourceSnapshot] = {}

        def snapshot_for(source_id: bytes) -> tuple[SourceSnapshot | None, Strictness | None]:
            entry = source_registry.get(encode_source_id_hex(source_id))
            if entry is None:
                return None, None
            return (
                source_snapshots.get(entry.source_id) or entry_snapshot(entry),
                entry.strictness,
            )

        last_sequence: int | None = None
        live_pipeline: LivePipeline | None = None
        live_worker: LivePipelineWorker | None = None
        drain_task: asyncio.Task[None] | None = None
        send_lock = asyncio.Lock()
        async for message in connection:
            if isinstance(message, bytes):
                if negotiated_version == PROTOCOL_V2:
                    try:
                        if len(message) < AUDIO_HEADER_V2.size:
                            raise ValueError("v1-shaped frame in v2 session")
                        packet_v2 = parse_audio_packet_v2(message)
                    except ValueError:
                        await connection.send(
                            json.dumps(
                                envelope(
                                    "error.protocol_mismatch",
                                    f"audio-{time.monotonic_ns()}",
                                    hello_envelope.session_id,
                                    {"message": "invalid v2 audio frame"},
                                    version=negotiated_version,
                                )
                            )
                        )
                        await connection.close(code=1008, reason="protocol_mismatch")
                        return
                    if last_sequence is not None and packet_v2.sequence <= last_sequence:
                        await connection.close(code=1008, reason="stale audio sequence")
                        return
                    last_sequence = packet_v2.sequence
                    if live_worker is not None:
                        # v2 live: route per immutable source id. The VAD
                        # state is created lazily on first packet and kept
                        # across registry/presentation updates; `start_source`
                        # is a no-op for an already-active source, so a rename
                        # never resets an in-flight utterance.
                        source_hex = encode_source_id_hex(packet_v2.source_id)
                        entry = source_registry.get(source_hex)
                        source_mode = (
                            profile_source_mode(entry.language_profile)
                            if entry is not None
                            else None
                        )
                        if live_pipeline is None or live_worker is None:
                            continue
                        live_pipeline.start_source(source_hex, source_mode=source_mode)
                        live_worker.submit(packet_v2)
                        continue
                    snapshot, strictness = snapshot_for(packet_v2.source_id)
                    for index, caption in enumerate(
                        fake_captions_v2(
                            hello_envelope.session_id,
                            packet_v2.sequence,
                            packet_v2.capture_monotonic_ns,
                            packet_v2.source_id,
                            snapshot,
                            strictness,
                        ),
                        start=1,
                    ):
                        await connection.send(
                            json.dumps(
                                envelope(
                                    f"caption.{caption.status}",
                                    f"caption-{packet_v2.sequence}-{index}",
                                    hello_envelope.session_id,
                                    dump_caption(caption, include_v2=True),
                                    version=negotiated_version,
                                )
                            )
                        )
                    continue
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
                            version=negotiated_version,
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
                            version=negotiated_version,
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
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "source.registry":
                if negotiated_version != PROTOCOL_V2:
                    await connection.close(code=1008, reason="v2 control in v1 session")
                    return
                registry = SourceRegistryPayload.model_validate(control.payload)
                source_registry.clear()
                for entry in registry.sources:
                    source_registry[entry.source_id] = entry
                    source_snapshots[entry.source_id] = entry_snapshot(entry)
                await connection.send(
                    json.dumps(
                        envelope(
                            "source.registry.accepted",
                            control.message_id,
                            control.session_id,
                            {"sources": len(registry.sources)},
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "source.presentation.update":
                if negotiated_version != PROTOCOL_V2:
                    await connection.close(code=1008, reason="v2 control in v1 session")
                    return
                update = SourcePresentationUpdatePayload.model_validate(control.payload)
                if update.source_id not in source_registry:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "source.presentation.error",
                                control.message_id,
                                control.session_id,
                                {"code": "unknown_source", "message": "unknown source"},
                                version=negotiated_version,
                            )
                        )
                    )
                    continue
                source_snapshots[update.source_id] = update.source_snapshot
                await connection.send(
                    json.dumps(
                        envelope(
                            "source.presentation.accepted",
                            control.message_id,
                            control.session_id,
                            {"source_id": update.source_id},
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "source.flush":
                if negotiated_version != PROTOCOL_V2:
                    await connection.close(code=1008, reason="v2 control in v1 session")
                    return
                payload = SourceControlPayload.model_validate(control.payload)
                if live_worker is None:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "source.error",
                                control.message_id,
                                control.session_id,
                                {
                                    "code": "NO_LIVE_SESSION",
                                    "message": "no live session to flush a source",
                                    "recoverable": True,
                                },
                                version=negotiated_version,
                            )
                        )
                    )
                    continue
                captions = await asyncio.to_thread(
                    live_worker.flush_source,
                    payload.source_id,
                )
                for index, caption in enumerate(captions, start=1):
                    caption = stamp_v2_caption(caption, source_registry, source_snapshots)
                    await connection.send(
                        json.dumps(
                            envelope(
                                f"caption.{caption.status}",
                                f"source-final-{index}",
                                control.session_id,
                                dump_caption(caption, include_v2=negotiated_version >= PROTOCOL_V2),
                                version=negotiated_version,
                            )
                        )
                    )
                await connection.send(
                    json.dumps(
                        envelope(
                            "source.flushed",
                            control.message_id,
                            control.session_id,
                            {
                                "source_id": payload.source_id,
                                "captions": len(captions),
                            },
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "source.stop":
                if negotiated_version != PROTOCOL_V2:
                    await connection.close(code=1008, reason="v2 control in v1 session")
                    return
                payload = SourceControlPayload.model_validate(control.payload)
                if live_worker is None:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "source.error",
                                control.message_id,
                                control.session_id,
                                {
                                    "code": "NO_LIVE_SESSION",
                                    "message": "no live session to stop a source",
                                    "recoverable": True,
                                },
                                version=negotiated_version,
                            )
                        )
                    )
                    continue
                captions, metrics = await asyncio.to_thread(
                    live_worker.stop_source,
                    payload.source_id,
                )
                metrics_dict = asdict(metrics)
                for index, caption in enumerate(captions, start=1):
                    caption = stamp_v2_caption(
                        caption,
                        source_registry,
                        source_snapshots,
                        overlap_status=(
                            live_worker._overlap.status_for if live_worker is not None else None
                        ),
                    )
                    await connection.send(
                        json.dumps(
                            envelope(
                                f"caption.{caption.status}",
                                f"source-final-{index}",
                                control.session_id,
                                dump_caption(caption, include_v2=negotiated_version >= PROTOCOL_V2),
                                version=negotiated_version,
                            )
                        )
                    )
                await connection.send(
                    json.dumps(
                        envelope(
                            "source.stopped",
                            control.message_id,
                            control.session_id,
                            {"source_id": payload.source_id, "metrics": metrics_dict},
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "source.diagnostics.request":
                if negotiated_version != PROTOCOL_V2:
                    await connection.close(code=1008, reason="v2 control in v1 session")
                    return
                payload = SourceControlPayload.model_validate(control.payload)
                diagnostics: dict[str, object]
                if live_worker is None:
                    diagnostics = {"source_id": payload.source_id, "active": False}
                else:
                    diagnostics = await asyncio.to_thread(
                        live_worker.source_diagnostics,
                        payload.source_id,
                    )
                stats = filter_stats_for(payload.source_id)
                diagnostics["filter"] = {
                    "applied": stats.applied,
                    "suppressed": stats.suppressed,
                    "flagged": stats.flagged,
                    "passed": stats.passed,
                    "off": stats.off,
                }
                await connection.send(
                    json.dumps(
                        envelope(
                            "source.diagnostics",
                            control.message_id,
                            control.session_id,
                            diagnostics,
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "scheduler.metrics.request":
                if live_worker is None:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "scheduler.error",
                                control.message_id,
                                control.session_id,
                                {"code": "NO_LIVE_SESSION", "message": "no live session"},
                                version=negotiated_version,
                            )
                        )
                    )
                    continue
                scheduler_metrics = await asyncio.to_thread(live_worker.scheduler_metrics)
                await connection.send(
                    json.dumps(
                        envelope(
                            "scheduler.metrics",
                            control.message_id,
                            control.session_id,
                            asdict(scheduler_metrics),
                            version=negotiated_version,
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
                    live_worker = LivePipelineWorker(
                        live_pipeline,
                        priority_of=lambda source_key: _priority_of_source(
                            source_key, source_registry
                        ),
                        language_profile_of=lambda source_key: _language_profile_of_source(
                            source_key, source_registry
                        ),
                    )
                    drain_task = asyncio.create_task(
                        drain_live_results(
                            connection,
                            hello_envelope.session_id,
                            live_worker,
                            send_lock,
                            version=negotiated_version,
                            stamp=(
                                _make_stamp(source_registry, source_snapshots, live_worker)
                                if negotiated_version == PROTOCOL_V2
                                else None
                            ),
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
                                version=negotiated_version,
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
                                "asr_runtime": getattr(asr_provider, "runtime_detail", "cpu/int8"),
                                "translation_runtime": getattr(
                                    translation_provider, "runtime_detail", "cpu/int8"
                                ),
                                "audio_format": {
                                    "sample_rate": 16_000,
                                    "channels": 1,
                                },
                            },
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "live.stop":
                stop_captions: tuple[CaptionPayload, ...] = ()
                if live_worker is not None:
                    if drain_task is not None:
                        drain_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await drain_task
                        drain_task = None
                    stop_captions, dropped_packets = live_worker.stop()
                    live_worker = None
                    stop_metrics: dict[str, object] = (
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
                    stop_metrics["packets_dropped"] = dropped_packets
                    live_pipeline = None
                else:
                    stop_metrics = {
                        "packets_received": 0,
                        "utterances_completed": 0,
                        "captions_emitted": 0,
                        "low_confidence_captions": 0,
                        "packets_dropped": 0,
                        "utterances_dropped": 0,
                    }
                for index, caption in enumerate(stop_captions, start=1):
                    await connection.send(
                        json.dumps(
                            envelope(
                                f"caption.{caption.status}",
                                f"live-final-{index}",
                                control.session_id,
                                dump_caption(caption, include_v2=negotiated_version >= PROTOCOL_V2),
                                version=negotiated_version,
                            )
                        )
                    )
                await connection.send(
                    json.dumps(
                        envelope(
                            "live.stopped",
                            control.message_id,
                            control.session_id,
                            {"metrics": stop_metrics},
                            version=negotiated_version,
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
                                version=negotiated_version,
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
                            version=negotiated_version,
                        )
                    )
                )
            elif control.type == "clip.compare":
                compare_request = ClipComparePayload.model_validate(control.payload)

                class _SidecarBuilders:
                    def asr(self, name: str) -> AsrProvider:
                        return build_asr_provider(name)

                    def translation(self, name: str) -> TranslationProvider:
                        return build_translation_provider(name)

                configs = (
                    tuple(
                        (f"custom-{a}+{t}", a, t)
                        for a, t in (tuple(c) for c in compare_request.configs)
                    )
                    if compare_request.configs
                    else KNOWN_CONFIGS
                )
                try:
                    report = await asyncio.to_thread(
                        compare_clips,
                        Path(compare_request.path),
                        compare_request.source_mode,
                        _SidecarBuilders(),
                        configs=configs,
                        app_version="0.4.0-dev",
                    )
                except Exception as error:
                    await connection.send(
                        json.dumps(
                            envelope(
                                "clip.compare.error",
                                control.message_id,
                                control.session_id,
                                {
                                    "code": "CLIP_COMPARE_FAILED",
                                    "message": str(error),
                                },
                                version=negotiated_version,
                            )
                        )
                    )
                    continue
                await connection.send(
                    json.dumps(
                        envelope(
                            "clip.compare.completed",
                            control.message_id,
                            control.session_id,
                            {
                                "path": report.path,
                                "source_mode": report.source_mode,
                                "file_size_bytes": report.file_size_bytes,
                                "duration_seconds": report.duration_seconds,
                                "captured_at_ms": report.captured_at_ms,
                                "app_version": report.app_version,
                                "runs": [
                                    {
                                        "label": run.label,
                                        "asr_name": run.asr_name,
                                        "translation_name": run.translation_name,
                                        "asr_ms": run.asr_ms,
                                        "translation_ms": run.translation_ms,
                                        "total_ms": run.total_ms,
                                        "model_id": run.model_id,
                                        "errors": list(run.errors),
                                        "critical_errors": run.critical_errors,
                                        "caption_count": len(run.clip.captions),
                                        "captions": (
                                            [
                                                {
                                                    "start_ms": caption.start_ms,
                                                    "end_ms": caption.end_ms,
                                                    "source_text": caption.source_text,
                                                    "english_text": caption.english_text,
                                                    "warnings": list(caption.warnings),
                                                }
                                                for caption in run.clip.captions
                                            ]
                                            if compare_request.include_transcripts
                                            else []
                                        ),
                                    }
                                    for run in report.runs
                                ],
                            },
                            version=negotiated_version,
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
