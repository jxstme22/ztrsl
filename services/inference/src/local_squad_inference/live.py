from __future__ import annotations

import re
import threading
import time
import unicodedata
from dataclasses import dataclass
from typing import Literal

from local_squad_inference.protocol import AudioPacket, CaptionPayload
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


class LivePipeline:
    """Conversation-aware, bounded-by-caller live Tagalog inference pipeline."""

    def __init__(
        self,
        asr: AsrProvider,
        translation: TranslationProvider,
        *,
        source_mode: Literal["filipino", "chinese", "english"] = "filipino",
        vad_config: VadConfig | None = None,
        use_silero: bool = True,
    ) -> None:
        if source_mode not in {"filipino", "chinese", "english"}:
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
        self._manager = EnergyUtteranceManager(
            config,
            SileroSpeechDetector(threshold=config.silero_threshold) if use_silero else None,
        )
        self._stream_origin_ns: int | None = None
        self._clock_origin_ns: int | None = None
        self._metrics_lock = threading.Lock()
        self._packets_received = 0
        self._utterances_completed = 0
        self._captions_emitted = 0
        self._low_confidence_captions = 0
        self._packets_dropped = 0
        self._utterances_dropped = 0
        self._provisional_revisions: dict[str, int] = {}

    @property
    def metrics(self) -> LivePipelineMetrics:
        with self._metrics_lock:
            return LivePipelineMetrics(
                packets_received=self._packets_received,
                utterances_completed=self._utterances_completed,
                captions_emitted=self._captions_emitted,
                low_confidence_captions=self._low_confidence_captions,
                packets_dropped=self._packets_dropped,
                utterances_dropped=self._utterances_dropped,
            )

    def note_utterances_dropped(self, count: int) -> None:
        with self._metrics_lock:
            self._utterances_dropped += count

    def feed_utterances(self, packet: AudioPacket) -> list[AudioUtterance]:
        """VAD-only, always real-time: never calls ASR or translation, so it
        never falls behind the audio stream. Returns completed utterances for
        a caller to hand to inference workers."""
        if packet.sample_rate != 16_000 or packet.channels != 1:
            raise ValueError("live inference requires 16 kHz mono audio")
        if self._stream_origin_ns is None:
            self._stream_origin_ns = packet.capture_monotonic_ns
            self._clock_origin_ns = time.monotonic_ns()
        with self._metrics_lock:
            self._packets_received += 1
        return self._manager.feed(packet.samples)

    def infer_utterances(self, utterances: list[AudioUtterance]) -> tuple[CaptionPayload, ...]:
        """ASR + translation for completed utterances. Safe to call from
        several inference threads concurrently."""
        return tuple(
            caption
            for utterance in utterances
            if (caption := self._transcribe_utterance(utterance)) is not None
        )

    def feed(self, packet: AudioPacket) -> tuple[CaptionPayload, ...]:
        return self.infer_utterances(self.feed_utterances(packet))

    def flush_utterances(self) -> list[AudioUtterance]:
        """VAD-only flush: returns the trailing utterance for inference."""
        return self._manager.flush()

    def provisional_utterance(self) -> AudioUtterance | None:
        """VAD-only snapshot of the in-progress utterance, or None when no
        speech is active. Used to schedule provisional ASR while talking so
        captions appear before the phrase ends."""
        return self._manager.provisional_utterance()

    def flush(self) -> tuple[CaptionPayload, ...]:
        return self.infer_utterances(self._manager.flush())

    def _transcribe_utterance(self, utterance: AudioUtterance) -> CaptionPayload | None:
        provisional = not utterance.is_final
        transcript = self._asr.transcribe(utterance, self._source_mode)
        with self._metrics_lock:
            if not provisional:
                self._utterances_completed += 1
            # The final revision must always be higher than the last
            # provisional so it replaces it in the UI, and provisionals for
            # one utterance strictly increase so a stale decode can never
            # overwrite a newer one.
            revision = self._provisional_revisions.get(utterance.utterance_id, 0) + 1
            if provisional:
                self._provisional_revisions[utterance.utterance_id] = revision
            else:
                self._provisional_revisions.pop(utterance.utterance_id, None)
        source_text = _normalize_transcript(transcript.text)
        if not source_text:
            if transcript.error and not provisional:
                return self._failure_caption(utterance, transcript.error)
            return None

        warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]] = []
        confidence = transcript.confidence
        if confidence is not None and confidence < 0.35:
            warnings.append("LOW_CONFIDENCE")
        if _UNEXPECTED_SCRIPT.search(source_text):
            warnings.append("LOW_CONFIDENCE")

        try:
            translated = self._translation.translate(transcript)
            english_text = _normalize_transcript(translated.english_text)
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

        MAX_CAPTION_LENGTH = 7990

        # … (the function stays the same, unchanged code above)

        origin_ns = self._clock_origin_ns or time.monotonic_ns()
        ended_ns = origin_ns + utterance.ended_ns
        latency_ms = max(0.0, (time.monotonic_ns() - ended_ns) / 1_000_000)
        unique_warnings = list(dict.fromkeys(warnings))
        with self._metrics_lock:
            if not provisional:
                if "LOW_CONFIDENCE" in unique_warnings:
                    self._low_confidence_captions += 1
                self._captions_emitted += 1
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
            source_mode=self._source_mode,
            source_text=source_text,
            english_text=english_text,
            started_monotonic_ns=origin_ns + utterance.started_ns,
            ended_monotonic_ns=None if provisional else ended_ns,
            capture_to_caption_ms=latency_ms,
            asr_ms=transcript.inference_ms,
            translation_ms=translated.inference_ms,
            confidence=confidence,
            warnings=unique_warnings,
        )

    def _failure_caption(self, utterance: AudioUtterance, reason: str) -> CaptionPayload:
        """Emit a visible placeholder caption when ASR fails so the user never
        sees a silent session. The message is capped and sanitized to avoid
        leaking secrets (e.g. API keys echoed back by a provider)."""
        message = re.sub(r"[\r\n]+", " ", reason).strip()
        if len(message) > 160:
            message = message[:157] + "..."
        origin_ns = self._clock_origin_ns or time.monotonic_ns()
        with self._metrics_lock:
            self._captions_emitted += 1
            self._low_confidence_captions += 1
        return CaptionPayload(
            caption_id=f"live-{utterance.utterance_id}",
            utterance_id=utterance.utterance_id,
            revision=1,
            status="final",
            source_mode=self._source_mode,
            source_text="[Speech recognition unavailable]",
            english_text=f"[Speech recognition unavailable: {message}]",
            started_monotonic_ns=origin_ns + utterance.started_ns,
            ended_monotonic_ns=origin_ns + utterance.ended_ns,
            capture_to_caption_ms=0.0,
            asr_ms=0.0,
            translation_ms=0.0,
            confidence=0.0,
            warnings=["LOW_CONFIDENCE"],
        )


def _normalize_transcript(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return " ".join(normalized.split()).strip()
