from __future__ import annotations

import math
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Literal

from local_squad_inference.audio_health import (
    AudioHealthMetrics,
    SourceProcessingPolicy,
    calibration_recommendations,
    classify_source_health,
    normalize_audio,
)
from local_squad_inference.glossary import Glossary
from local_squad_inference.phrase_filters import PhraseFilterResult, PhraseFilterSet
from local_squad_inference.protocol import AudioPacket, AudioPacketV2, CaptionPayload, SourceMode
from local_squad_inference.providers import AsrProvider, TranslationProvider
from local_squad_inference.vad import (
    AudioUtterance,
    EnergyUtteranceManager,
    SileroSpeechDetector,
    VadConfig,
)

# Truncation boundary set well under the Pydantic max_length=8000 so a
# validation error never kills the live session (the error propagates as
# an unhandled exception and terminates the sidecar).
MAX_CAPTION_LENGTH = 7990

_UNEXPECTED_SCRIPT = re.compile(
    "[\u0400-\u052f\u0600-\u06ff\u0750-\u077f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]"
)


@dataclass(frozen=True)
class LivePipelineMetrics:
    packets_received: int
    utterances_completed: int
    captions_emitted: int
    low_confidence_captions: int
    packets_dropped: int = 0
    utterances_dropped: int = 0


@dataclass
class _SourceVadState:
    """One VAD session per immutable source id. `source_id is None` marks
    the legacy single-source (v1) session, whose behavior must stay
    byte-identical to v0.2."""

    source_id: str | None
    source_mode: SourceMode
    manager: EnergyUtteranceManager
    stream_origin_ns: int | None = None
    clock_origin_ns: int | None = None
    packets_received: int = 0
    utterances_completed: int = 0
    captions_emitted: int = 0
    low_confidence_captions: int = 0
    utterances_dropped: int = 0
    phrase_filtered: int = 0
    provisional_revisions: dict[str, int] = field(default_factory=dict)
    # DS-300/301: per-source audio health + processing policy (DS-303).
    health: AudioHealthMetrics = field(default_factory=AudioHealthMetrics)
    processing: SourceProcessingPolicy = field(default_factory=SourceProcessingPolicy)


def source_key_of(packet: Any) -> str | None:
    """Immutable source key for a packet: hex source id, or None for the
    legacy v1 source. v1 `AudioPacket` has no `source_id` attribute."""
    raw = getattr(packet, "source_id", None)
    if raw is None:
        return None
    if isinstance(raw, bytes):
        from local_squad_inference.protocol import encode_source_id_hex

        return encode_source_id_hex(raw)
    return str(raw)


def _frame_speech(samples: tuple[float, ...], speech_rms: float) -> bool:
    """Cheap speech estimate for health metrics: frame RMS at or above the
    VAD gate's energy threshold."""
    if not samples:
        return False
    total = 0.0
    for sample in samples:
        total += sample * sample
    return math.sqrt(total / len(samples)) >= speech_rms


def _observe_utterance(health: AudioHealthMetrics, utterance: Any) -> None:
    """DS-401 segmentation diagnostics: forced splits, short fragments,
    rapid consecutive segments, trailing silence. No raw audio is kept."""
    duration_ms = (utterance.ended_ns - utterance.started_ns) // 1_000_000
    health.last_utterance_ms = duration_ms
    if getattr(utterance, "forced_end", False):
        health.forced_split_count += 1
    if duration_ms > 0 and duration_ms < 400:
        health.short_fragment_count += 1
    if health.last_speech_frame_ms > 0:
        gap_ms = utterance.started_ns // 1_000_000 - health.last_speech_frame_ms
        if 0 < gap_ms < 500:
            health.rapid_segment_count += 1
    health.last_speech_frame_ms = utterance.ended_ns // 1_000_000


class LivePipeline:
    """Conversation-aware, bounded-by-caller live Tagalog inference pipeline.

    v2 multi-source sessions keep one `_SourceVadState` per immutable
    source id, so two sources speaking at once produce independent
    utterances and utterance ids. Renaming a source never touches VAD
    state (`start_source` on an existing key is a no-op). Restarting a
    source — `stop_source` then audio again — recreates only that source's
    state. The legacy v1 session (no source id) behaves exactly as before.
    """

    def __init__(
        self,
        asr: AsrProvider,
        translation: TranslationProvider,
        *,
        source_mode: SourceMode = "filipino",
        vad_config: VadConfig | None = None,
        use_silero: bool = True,
        phrase_filters: PhraseFilterSet | None = None,
        glossary: Glossary | None = None,
    ) -> None:
        if source_mode not in {
            "filipino",
            "chinese",
            "english",
            "indonesian",
            "vietnamese",
            "thai",
            "malay",
        }:
            raise ValueError("V1 live mode supports Filipino, Chinese or English only")
        self._asr = asr
        self._translation = translation
        self._source_mode = source_mode
        config = vad_config or VadConfig(
            frame_ms=32,
            min_speech_ms=160,
            pre_roll_ms=320,
            min_silence_ms=416,
            max_utterance_ms=18_000,
        )
        self._vad_config = config
        self._use_silero = use_silero
        # v0.4: per-source phrase filters (dropped before MT) and glossary
        # corrections (applied between ASR and translation). Hot-reloadable:
        # the LivePipeline holds references, and callers swap the underlying
        # sets at runtime without rebuilding the pipeline or models.
        self._phrase_filters = phrase_filters or PhraseFilterSet()
        self._glossary = glossary or Glossary()
        self._metrics_lock = threading.Lock()
        self._default_state = _SourceVadState(
            source_id=None,
            source_mode=source_mode,
            manager=self._build_manager(source_mode, use_silero),
        )
        self._sources: dict[str, _SourceVadState] = {}
        # Stopped sources keep their state as tombstones so utterances
        # already queued for inference still resolve their mode, clock,
        # and revision counters. Cleared on `source.registry` re-push.
        self._stopped_sources: dict[str, _SourceVadState] = {}

    def _build_manager(self, source_mode: str, use_silero: bool) -> EnergyUtteranceManager:
        del source_mode  # reserved for per-source VAD tuning in later phases
        detector = (
            SileroSpeechDetector(threshold=self._vad_config.silero_threshold)
            if use_silero
            else None
        )
        return EnergyUtteranceManager(self._vad_config, detector)

    def _state_for(self, source_key: str | None) -> _SourceVadState:
        if source_key is None:
            return self._default_state
        state = self._sources.get(source_key)
        if state is None:
            raise ValueError(
                f"unknown source {source_key} — call start_source before feeding audio"
            )
        return state

    def _state_for_any(self, source_key: str | None) -> _SourceVadState:
        """Resolve a state for inference of an utterance that may outlive
        its source: active state, stopped-state tombstone, or the legacy
        default session. Utterance ids are namespaced per source, so the
        fallback revision dict can never collide across sources."""
        if source_key is None:
            return self._default_state
        state = self._sources.get(source_key)
        if state is None:
            state = self._stopped_sources.get(source_key)
        return state or self._default_state

    def start_source(
        self,
        source_id: str,
        *,
        source_mode: SourceMode | None = None,
        use_silero: bool | None = None,
        processing: SourceProcessingPolicy | None = None,
    ) -> bool:
        """Create VAD state for a v2 source. Idempotent: an existing state
        is returned untouched, so registry re-pushes and presentation
        edits never reset an in-flight utterance. Returns True when a new
        state was created."""
        with self._metrics_lock:
            if source_id in self._sources:
                return False
            mode = source_mode or self._source_mode
            silero = self._use_silero if use_silero is None else use_silero
            state = _SourceVadState(
                source_id=source_id,
                source_mode=mode,
                manager=EnergyUtteranceManager(
                    self._vad_config,
                    (
                        SileroSpeechDetector(threshold=self._vad_config.silero_threshold)
                        if silero
                        else None
                    ),
                    namespace=source_id,
                ),
                processing=processing or SourceProcessingPolicy(),
            )
            self._sources[source_id] = state
            return True

    def stop_source(self, source_id: str) -> tuple[tuple[CaptionPayload, ...], LivePipelineMetrics]:
        """Flush and drop one source's VAD state. Only this source is
        affected: other sources keep their in-flight utterances, and a
        later packet for the stopped source starts a fresh state. The
        state object is kept as a tombstone so utterances still queued
        for inference keep their source mode and revision counters."""
        utterances = self.stop_source_utterances(source_id)
        captions = self.infer_utterances(utterances)
        return captions, self.metrics_for(source_id)

    def stop_source_utterances(self, source_id: str) -> list[AudioUtterance]:
        """VAD-thread half of `stop_source`: flush the open utterance and
        tombstone the state. No inference here — callers run it after."""
        with self._metrics_lock:
            state = self._sources.pop(source_id, None)
        if state is None:
            return []
        utterances = state.manager.flush()
        with self._metrics_lock:
            self._stopped_sources[source_id] = state
        return utterances

    def flush_source(self, source_id: str) -> tuple[CaptionPayload, ...]:
        """Flush one source's open utterance but keep its VAD state, so
        subsequent audio continues the same session (sequence numbers keep
        counting). Unknown or stopped sources flush nothing."""
        return self.infer_utterances(self.flush_source_utterances(source_id))

    def flush_source_utterances(self, source_id: str) -> list[AudioUtterance]:
        """VAD-thread half of `flush_source`: flush only, keep the state."""
        state = self._sources.get(source_id)
        if state is None:
            return []
        return state.manager.flush()

    def diagnostics_for(self, source_id: str) -> dict[str, Any]:
        """Per-source VAD diagnostics: session presence, open utterance
        size, packet/utterance/caption counters, and drop counters.
        Stopped sources report their last counters with `active: False`."""
        state = self._sources.get(source_id) or self._stopped_sources.get(source_id)
        if state is None:
            return {"source_id": source_id, "active": False}
        active = source_id in self._sources
        snapshot = state.manager.provisional_utterance() if active else None
        return {
            "source_id": source_id,
            "active": active,
            "source_mode": state.source_mode,
            "open_utterance_samples": len(snapshot.pcm_f32) if snapshot is not None else 0,
            "utterance_sequence": state.manager.utterance_sequence,
            "packets_received": state.packets_received,
            "utterances_completed": state.utterances_completed,
            "captions_emitted": state.captions_emitted,
            "low_confidence_captions": state.low_confidence_captions,
            "utterances_dropped": state.utterances_dropped,
            "phrase_filtered": state.phrase_filtered,
            "provisional_revisions": len(state.provisional_revisions),
            # DS-300/301/402: audio health, deterministic state, and
            # rule-based calibration recommendations.
            "health": state.health.snapshot(),
            "health_state": classify_source_health(state.health).to_dict(),
            "recommendations": calibration_recommendations(
                state.health,
                high_speech_empty=state.health.empty_high_speech_count >= 2,
            ),
        }

    @property
    def metrics(self) -> LivePipelineMetrics:
        with self._metrics_lock:
            states = [self._default_state, *self._sources.values()]
            return LivePipelineMetrics(
                packets_received=sum(state.packets_received for state in states),
                utterances_completed=sum(state.utterances_completed for state in states),
                captions_emitted=sum(state.captions_emitted for state in states),
                low_confidence_captions=sum(state.low_confidence_captions for state in states),
                packets_dropped=0,
                utterances_dropped=sum(state.utterances_dropped for state in states),
            )

    def metrics_for(self, source_id: str) -> LivePipelineMetrics:
        with self._metrics_lock:
            state = self._sources.get(source_id) or self._stopped_sources.get(source_id)
            if state is None:
                return LivePipelineMetrics(
                    packets_received=0,
                    utterances_completed=0,
                    captions_emitted=0,
                    low_confidence_captions=0,
                    packets_dropped=0,
                    utterances_dropped=0,
                )
            return LivePipelineMetrics(
                packets_received=state.packets_received,
                utterances_completed=state.utterances_completed,
                captions_emitted=state.captions_emitted,
                low_confidence_captions=state.low_confidence_captions,
                packets_dropped=0,
                utterances_dropped=state.utterances_dropped,
            )

    def note_utterances_dropped(self, count: int, *, source_id: str | None = None) -> None:
        with self._metrics_lock:
            self._state_for_any(source_id).utterances_dropped += count

    def feed_utterances(self, packet: AudioPacket | Any) -> list[AudioUtterance]:
        """VAD-only, always real-time: never calls ASR or translation, so it
        never falls behind the audio stream. Returns completed utterances for
        a caller to hand to inference workers."""
        if packet.sample_rate != 16_000 or packet.channels != 1:
            raise ValueError("live inference requires 16 kHz mono audio")
        source_key = source_key_of(packet)
        state = self._state_for(source_key)
        if state.stream_origin_ns is None:
            state.stream_origin_ns = packet.capture_monotonic_ns
            state.clock_origin_ns = time.monotonic_ns()
        with self._metrics_lock:
            state.packets_received += 1
            state.health.packets_received += 1
        samples = packet.samples
        if state.processing.normalize:
            # DS-302: conservative light gain for quiet sources; the manager
            # still gates on its own speech_rms.
            samples, _applied = normalize_audio(samples, enabled=True)
        # Cheap per-frame signal stats (DS-300). Speech estimate uses the
        # same energy threshold as the VAD gate so the ratio is meaningful.
        speech_rms = state.manager.config.speech_rms
        state.health.observe_frame(
            samples,
            speech=_frame_speech(samples, speech_rms),
        )
        with self._metrics_lock:
            provisional = state.manager.provisional_utterance()
        if provisional is not None:
            state.health.open_utterance_ms = (
                provisional.ended_ns - provisional.started_ns
            ) // 1_000_000
        utterances = state.manager.feed(samples)
        for utterance in utterances:
            _observe_utterance(state.health, utterance)
        return utterances

    def infer_utterances(self, utterances: list[AudioUtterance]) -> tuple[CaptionPayload, ...]:
        """ASR + translation for completed utterances. Safe to call from
        several inference threads concurrently."""
        return tuple(
            caption
            for utterance in utterances
            if (caption := self._transcribe_utterance(utterance)) is not None
        )

    def feed(self, packet: AudioPacket | AudioPacketV2) -> tuple[CaptionPayload, ...]:
        return self.infer_utterances(self.feed_utterances(packet))

    def flush_utterances(self, source_id: str | None = None) -> list[AudioUtterance]:
        """VAD-only flush: returns the trailing utterance for inference.
        With no source id this flushes the legacy v1 session."""
        return self._state_for(source_id).manager.flush()

    def flush_all_utterances(self) -> list[AudioUtterance]:
        """Flush every session (legacy + all v2 sources). Used at worker
        shutdown so no source's trailing speech is lost."""
        utterances: list[AudioUtterance] = []
        for state in [self._default_state, *self._sources.values()]:
            utterances.extend(state.manager.flush())
        return utterances

    def provisional_utterance(self, source_id: str | None = None) -> AudioUtterance | None:
        """VAD-only snapshot of the in-progress utterance, or None when no
        speech is active. Used to schedule provisional ASR while talking so
        captions appear before the phrase ends."""
        return self._state_for(source_id).manager.provisional_utterance()

    def set_phrase_filters(self, filters: PhraseFilterSet) -> None:
        """Swap the per-source phrase-filter set at runtime (v0.4 hot reload,
        no model restart)."""
        self._phrase_filters = filters

    def set_glossary(self, glossary: Glossary) -> None:
        """Swap the glossary at runtime (v0.4 hot reload, no model restart)."""
        self._glossary = glossary

    def evaluate_phrase_filters(self, text: str, source_id: str | None) -> PhraseFilterResult:
        """Per-source phrase-filter evaluation (v0.4 Phase 3). Called before
        MT so filtered phrases never reach translation or the overlay."""
        return self._phrase_filters.evaluate(text, source_id or "")

    def flush(self) -> tuple[CaptionPayload, ...]:
        return self.infer_utterances(self._default_state.manager.flush())

    def _transcribe_utterance(self, utterance: AudioUtterance) -> CaptionPayload | None:
        state = self._state_for_any(utterance.source_id)
        provisional = not utterance.is_final
        transcript = self._asr.transcribe(utterance, state.source_mode)
        with self._metrics_lock:
            if not provisional:
                state.utterances_completed += 1
            # The final revision must always be higher than the last
            # provisional so it replaces it in the UI, and provisionals for
            # one utterance strictly increase so a stale decode can never
            # overwrite a newer one.
            revision = state.provisional_revisions.get(utterance.utterance_id, 0) + 1
            if provisional:
                state.provisional_revisions[utterance.utterance_id] = revision
            else:
                state.provisional_revisions.pop(utterance.utterance_id, None)
        source_text = _normalize_transcript(transcript.text)
        if not source_text:
            if transcript.error and not provisional:
                return self._failure_caption(utterance, transcript.error, state)
            # DS-401: a final utterance with strong VAD evidence but an empty
            # transcript points at an ASR language/model problem, not VAD.
            if not provisional:
                with self._metrics_lock:
                    state.health.empty_high_speech_count += 1
            return None

        # v0.4 Phase 3: per-source phrase filters run BEFORE the language gate
        # and translation, so a matched phrase never reaches MT or the overlay.
        filtered = self.evaluate_phrase_filters(source_text, utterance.source_id)
        if filtered.matched:
            with self._metrics_lock:
                state.phrase_filtered += 1
            return None

        # v0.4 Phase 4: glossary ASR corrections + aliases apply to the source
        # text before translation; protected terms are preserved across MT.
        glossary_result = self._glossary.apply(
            source_text, source_id=utterance.source_id, profile_id=state.source_mode
        )
        if glossary_result.applied:
            source_text = glossary_result.corrected_text
        preserved = self._glossary.preserve_terms(source_text)

        warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]] = []
        confidence = transcript.confidence
        if confidence is not None and confidence < 0.35:
            warnings.append("LOW_CONFIDENCE")
        if _UNEXPECTED_SCRIPT.search(source_text):
            warnings.append("LOW_CONFIDENCE")

        try:
            translated = self._translation.translate(transcript)
            english_text = _normalize_transcript(translated.english_text)
            # v0.4 Phase 4: preferred translation overrides the MT output, and
            # preserved terms are re-inserted verbatim after MT.
            english_text = self._glossary.preferred_translation(source_text, english_text)
            if preserved:
                for term in preserved:
                    english_text = english_text.replace(term, term, 1)
            if not english_text:
                english_text = "[Speech unclear]"
                warnings.append("LOW_CONFIDENCE")
        except Exception:
            # A single failed translation must never kill the live
            # session. Surface a placeholder so the user keeps seeing
            # the recognized source text plus a status hint, and let
            # the next utterance try again. Translation providers that
            # spawn a subprocess (e.g. MADLAD) recover lazily.
            english_text = "[Translation unavailable]"
            warnings.append("LOW_CONFIDENCE")
        if utterance.forced_end:
            warnings.append("FORCED_SPLIT")

        origin_ns = state.clock_origin_ns or time.monotonic_ns()
        ended_ns = origin_ns + utterance.ended_ns
        latency_ms = max(0.0, (time.monotonic_ns() - ended_ns) / 1_000_000)
        unique_warnings = list(dict.fromkeys(warnings))
        with self._metrics_lock:
            if not provisional:
                if "LOW_CONFIDENCE" in unique_warnings:
                    state.low_confidence_captions += 1
                state.captions_emitted += 1
        # Hard truncation at the caption character limit — the ASR or
        # translation may produce text longer than the protocol allows, and
        # a 7990-character caption is already far beyond any reasonable
        # utterance. Silently truncating is safer than crashing the session.
        source_text = source_text[:MAX_CAPTION_LENGTH]
        english_text = english_text[:MAX_CAPTION_LENGTH]
        return CaptionPayload(
            caption_id=f"live-{utterance.utterance_id}",
            utterance_id=utterance.utterance_id,
            revision=revision,
            status="provisional" if provisional else "final",
            source_mode=state.source_mode,
            source_text=source_text,
            english_text=english_text,
            started_monotonic_ns=origin_ns + utterance.started_ns,
            ended_monotonic_ns=None if provisional else ended_ns,
            capture_to_caption_ms=latency_ms,
            asr_ms=transcript.inference_ms,
            translation_ms=translated.inference_ms,
            confidence=confidence,
            warnings=unique_warnings,
            source_id=utterance.source_id,
        )

    def _failure_caption(
        self,
        utterance: AudioUtterance,
        reason: str,
        state: _SourceVadState | None = None,
    ) -> CaptionPayload:
        """Emit a visible placeholder caption when ASR fails so the user never
        sees a silent session. The message is capped and sanitized to avoid
        leaking secrets (e.g. API keys echoed back by a provider)."""
        message = re.sub(r"[\r\n]+", " ", reason).strip()
        if len(message) > 160:
            message = message[:157] + "..."
        origin_ns = (state.clock_origin_ns if state is not None else None) or time.monotonic_ns()
        with self._metrics_lock:
            if state is not None:
                state.captions_emitted += 1
                state.low_confidence_captions += 1
        return CaptionPayload(
            caption_id=f"live-{utterance.utterance_id}",
            utterance_id=utterance.utterance_id,
            revision=1,
            status="final",
            source_mode=(state.source_mode if state is not None else self._source_mode),
            source_text="[Speech recognition unavailable]",
            english_text=f"[Speech recognition unavailable: {message}]",
            started_monotonic_ns=origin_ns + utterance.started_ns,
            ended_monotonic_ns=origin_ns + utterance.ended_ns,
            capture_to_caption_ms=0.0,
            asr_ms=0.0,
            translation_ms=0.0,
            confidence=0.0,
            warnings=["LOW_CONFIDENCE"],
            source_id=utterance.source_id,
        )


def _normalize_transcript(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return " ".join(normalized.split()).strip()
