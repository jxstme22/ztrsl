from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class VadConfig:
    frame_ms: int = 30
    speech_rms: float = 0.018
    min_speech_ms: int = 180
    pre_roll_ms: int = 180
    min_silence_ms: int = 450
    max_utterance_ms: int = 12_000


@dataclass(frozen=True)
class AudioUtterance:
    utterance_id: str
    pcm_f32: tuple[float, ...]
    sample_rate: int
    started_ns: int
    ended_ns: int
    is_final: bool
    forced_end: bool


class EnergyUtteranceManager:
    """Deterministic CI fallback; Silero can replace the speech predicate."""

    def __init__(self, config: VadConfig | None = None) -> None:
        self.config = config or VadConfig()
        self.frame_samples = SAMPLE_RATE * self.config.frame_ms // 1_000
        self._pending: list[float] = []
        self._pre_roll: deque[tuple[float, ...]] = deque(
            maxlen=max(
                1,
                (self.config.pre_roll_ms + self.config.min_speech_ms)
                // self.config.frame_ms,
            )
        )
        self._active: list[float] | None = None
        self._active_started_sample = 0
        self._speech_frames = 0
        self._silence_frames = 0
        self._total_samples = 0
        self._utterance_sequence = 0

    def feed(self, samples: tuple[float, ...]) -> list[AudioUtterance]:
        self._pending.extend(samples)
        completed: list[AudioUtterance] = []
        while len(self._pending) >= self.frame_samples:
            frame = tuple(self._pending[: self.frame_samples])
            del self._pending[: self.frame_samples]
            utterance = self._feed_frame(frame)
            if utterance is not None:
                completed.append(utterance)
        return completed

    def flush(self) -> list[AudioUtterance]:
        if self._pending:
            padded = tuple(self._pending) + (0.0,) * (self.frame_samples - len(self._pending))
            self._pending.clear()
            utterance = self._feed_frame(padded)
            if utterance is not None:
                return [utterance]
        if self._active is None:
            return []
        return [self._finish(forced=False)]

    def _feed_frame(self, frame: tuple[float, ...]) -> AudioUtterance | None:
        frame_start = self._total_samples
        self._total_samples += len(frame)
        rms = math.sqrt(sum(sample * sample for sample in frame) / len(frame))
        is_speech = rms >= self.config.speech_rms

        if self._active is None:
            self._pre_roll.append(frame)
            if is_speech:
                self._speech_frames += 1
            else:
                self._speech_frames = 0
            required = max(1, self.config.min_speech_ms // self.config.frame_ms)
            if self._speech_frames >= required:
                prefix = list(self._pre_roll)
                self._active = [sample for buffered in prefix for sample in buffered]
                self._active_started_sample = max(
                    0, frame_start + len(frame) - len(self._active)
                )
                self._silence_frames = 0
                self._pre_roll.clear()
            return None

        self._active.extend(frame)
        self._silence_frames = 0 if is_speech else self._silence_frames + 1
        max_samples = SAMPLE_RATE * self.config.max_utterance_ms // 1_000
        if len(self._active) >= max_samples:
            return self._finish(forced=True)
        silence_required = max(1, self.config.min_silence_ms // self.config.frame_ms)
        if self._silence_frames >= silence_required:
            return self._finish(forced=False)
        return None

    def _finish(self, forced: bool) -> AudioUtterance:
        assert self._active is not None
        self._utterance_sequence += 1
        samples = tuple(self._active)
        started_ns = self._active_started_sample * 1_000_000_000 // SAMPLE_RATE
        ended_ns = (self._active_started_sample + len(samples)) * 1_000_000_000 // SAMPLE_RATE
        overlap_frames: tuple[tuple[float, ...], ...] = ()
        if forced:
            overlap_count = max(1, self.config.pre_roll_ms // self.config.frame_ms)
            overlap_samples = overlap_count * self.frame_samples
            tail = samples[-overlap_samples:]
            overlap_frames = tuple(
                tuple(tail[index : index + self.frame_samples])
                for index in range(0, len(tail), self.frame_samples)
            )
        self._active = None
        self._speech_frames = 0
        self._silence_frames = 0
        self._pre_roll.clear()
        if forced:
            self._pre_roll.extend(overlap_frames)
            self._speech_frames = max(
                0, self.config.min_speech_ms // self.config.frame_ms - 1
            )
        return AudioUtterance(
            utterance_id=f"clip-utterance-{self._utterance_sequence}",
            pcm_f32=samples,
            sample_rate=SAMPLE_RATE,
            started_ns=started_ns,
            ended_ns=ended_ns,
            is_final=True,
            forced_end=forced,
        )
