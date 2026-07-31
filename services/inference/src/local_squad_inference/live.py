from __future__ import annotations

import re
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

_UNEXPECTED_SCRIPT = re.compile(
    "[\u0400-\u052f\u0600-\u06ff\u0750-\u077f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]"
)


@dataclass(frozen=True)
class LivePipelineMetrics:
    packets_received: int
    utterances_completed: int
    captions_emitted: int
    low_confidence_captions: int


class LivePipeline:
    """Conversation-aware, bounded-by-caller live Tagalog inference pipeline."""

    def __init__(
        self,
        asr: AsrProvider,
        translation: TranslationProvider,
        *,
        source_mode: str = "filipino",
        vad_config: VadConfig | None = None,
        use_silero: bool = True,
    ) -> None:
        if source_mode != "filipino":
            raise ValueError("V1 live mode supports Filipino / Taglish only")
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
            SileroSpeechDetector() if use_silero else None,
        )
        self._stream_origin_ns: int | None = None
        self._clock_origin_ns: int | None = None
        self._packets_received = 0
        self._utterances_completed = 0
        self._captions_emitted = 0
        self._low_confidence_captions = 0

    @property
    def metrics(self) -> LivePipelineMetrics:
        return LivePipelineMetrics(
            packets_received=self._packets_received,
            utterances_completed=self._utterances_completed,
            captions_emitted=self._captions_emitted,
            low_confidence_captions=self._low_confidence_captions,
        )

    def feed(self, packet: AudioPacket) -> tuple[CaptionPayload, ...]:
        if packet.sample_rate != 16_000 or packet.channels != 1:
            raise ValueError("live inference requires 16 kHz mono audio")
        if self._stream_origin_ns is None:
            self._stream_origin_ns = packet.capture_monotonic_ns
            self._clock_origin_ns = time.monotonic_ns()
        self._packets_received += 1
        return self._transcribe(self._manager.feed(packet.samples))

    def flush(self) -> tuple[CaptionPayload, ...]:
        return self._transcribe(self._manager.flush())

    def _transcribe(self, utterances: list[AudioUtterance]) -> tuple[CaptionPayload, ...]:
        captions: list[CaptionPayload] = []
        for utterance in utterances:
            transcript = self._asr.transcribe(utterance, self._source_mode)
            self._utterances_completed += 1
            source_text = _normalize_transcript(transcript.text)
            if not source_text:
                continue

            warnings: list[Literal["LOW_CONFIDENCE", "FORCED_SPLIT"]] = []
            confidence = transcript.confidence
            if confidence is not None and confidence < 0.35:
                warnings.append("LOW_CONFIDENCE")
            if _UNEXPECTED_SCRIPT.search(source_text):
                warnings.append("LOW_CONFIDENCE")

            translated = self._translation.translate(transcript)
            english_text = _normalize_transcript(translated.english_text)
            if not english_text:
                english_text = "[Speech unclear]"
                warnings.append("LOW_CONFIDENCE")
            if utterance.forced_end:
                warnings.append("FORCED_SPLIT")

            origin_ns = self._clock_origin_ns or time.monotonic_ns()
            ended_ns = origin_ns + utterance.ended_ns
            latency_ms = max(0.0, (time.monotonic_ns() - ended_ns) / 1_000_000)
            unique_warnings = list(dict.fromkeys(warnings))
            if "LOW_CONFIDENCE" in unique_warnings:
                self._low_confidence_captions += 1
            self._captions_emitted += 1
            captions.append(
                CaptionPayload(
                    caption_id=f"live-{utterance.utterance_id}",
                    utterance_id=utterance.utterance_id,
                    revision=1,
                    status="final",
                    source_mode="filipino",
                    source_text=source_text,
                    english_text=english_text,
                    started_monotonic_ns=origin_ns + utterance.started_ns,
                    ended_monotonic_ns=ended_ns,
                    capture_to_caption_ms=latency_ms,
                    asr_ms=transcript.inference_ms,
                    translation_ms=translated.inference_ms,
                    confidence=confidence,
                    warnings=unique_warnings,
                )
            )
        return tuple(captions)


def _normalize_transcript(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return " ".join(normalized.split()).strip()
