from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class VadConfig:
    frame_ms: int = 30
    speech_rms: float = 0.018
    silero_threshold: float = 0.5
    min_speech_ms: int = 180
    pre_roll_ms: int = 180
    min_silence_ms: int = 450
    max_utterance_ms: int = 12_000


def vad_config_from_sensitivity(sensitivity: int) -> VadConfig:
    """Map a 0..100 sensitivity slider to a VadConfig.

    Higher sensitivity means quieter/softer speech is treated as speech:
    the Silero threshold and energy RMS gate both drop, and shorter silence
    closes utterances sooner so a noisy background is less likely to merge
    separate speakers. The baseline (sensitivity == 50) matches the default
    VadConfig values.
    """
    clamped = max(0, min(100, sensitivity))
    factor = clamped / 100.0
    silero_threshold = round(0.70 - 0.40 * factor, 3)
    speech_rms = round(0.030 - 0.024 * factor, 4)
    min_silence_ms = round(700 - 500 * factor)
    return VadConfig(
        frame_ms=32,
        speech_rms=max(0.002, speech_rms),
        silero_threshold=max(0.20, min(0.70, silero_threshold)),
        min_speech_ms=180,
        pre_roll_ms=180,
        min_silence_ms=max(150, min_silence_ms),
        max_utterance_ms=12_000,
    )


@dataclass(frozen=True)
class AudioUtterance:
    utterance_id: str
    pcm_f32: tuple[float, ...]
    sample_rate: int
    started_ns: int
    ended_ns: int
    is_final: bool
    forced_end: bool


class SpeechDetector(Protocol):
    def is_speech(self, frame: tuple[float, ...]) -> bool: ...


class EnergySpeechDetector:
    def __init__(self, threshold: float) -> None:
        self._threshold = threshold

    def is_speech(self, frame: tuple[float, ...]) -> bool:
        rms = math.sqrt(sum(sample * sample for sample in frame) / len(frame))
        if not math.isfinite(rms):
            return False
        return rms >= self._threshold


class SileroSpeechDetector:
    """Stateful 16 kHz Silero VAD using the model shipped with faster-whisper."""

    frame_samples = 512
    context_samples = 64

    def __init__(self, *, threshold: float = 0.5, model_path: Path | None = None) -> None:
        import numpy
        import onnxruntime
        from faster_whisper.utils import get_assets_path

        path = model_path or Path(get_assets_path()) / "silero_vad_v6.onnx"
        options = onnxruntime.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        options.log_severity_level = 4
        self._session: Any = onnxruntime.InferenceSession(
            str(path),
            providers=["CPUExecutionProvider"],
            sess_options=options,
        )
        self._numpy: Any = numpy
        self._threshold = threshold
        self._hidden = numpy.zeros((1, 1, 128), dtype=numpy.float32)
        self._cell = numpy.zeros((1, 1, 128), dtype=numpy.float32)
        self._context = numpy.zeros((1, self.context_samples), dtype=numpy.float32)

    def is_speech(self, frame: tuple[float, ...]) -> bool:
        if len(frame) != self.frame_samples:
            raise ValueError("Silero VAD requires 512-sample frames at 16 kHz")
        audio = self._numpy.asarray(frame, dtype=self._numpy.float32).reshape(1, self.frame_samples)
        if not bool(self._numpy.isfinite(audio).all()):
            self._reset_state()
            return False
        model_input = self._numpy.concatenate((self._context, audio), axis=1)
        probabilities, hidden, cell = self._session.run(
            None,
            {
                "input": model_input,
                "h": self._hidden,
                "c": self._cell,
            },
        )
        probability = float(probabilities.reshape(-1)[0])
        self._hidden = hidden
        self._cell = cell
        self._context = audio[:, -self.context_samples :]
        if (
            not math.isfinite(probability)
            or not bool(self._numpy.isfinite(hidden).all())
            or not bool(self._numpy.isfinite(cell).all())
        ):
            # A poisoned recurrent state never recovers on its own: NaN
            # propagates through every later frame and turns all speech into
            # silence, so the session silently goes deaf mid-conversation.
            # Reset the state so the next frame starts clean instead.
            self._reset_state()
            return False
        return probability >= self._threshold

    def _reset_state(self) -> None:
        self._hidden = self._numpy.zeros((1, 1, 128), dtype=self._numpy.float32)
        self._cell = self._numpy.zeros((1, 1, 128), dtype=self._numpy.float32)
        self._context = self._numpy.zeros((1, self.context_samples), dtype=self._numpy.float32)


class EnergyUtteranceManager:
    """Bounded utterance manager with a replaceable speech predicate."""

    def __init__(
        self,
        config: VadConfig | None = None,
        speech_detector: SpeechDetector | None = None,
    ) -> None:
        self.config = config or VadConfig()
        self.frame_samples = SAMPLE_RATE * self.config.frame_ms // 1_000
        self._speech_detector = speech_detector or EnergySpeechDetector(self.config.speech_rms)
        self._pending: list[float] = []
        self._pre_roll: deque[tuple[float, ...]] = deque(
            maxlen=max(
                1,
                (self.config.pre_roll_ms + self.config.min_speech_ms) // self.config.frame_ms,
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

    def provisional_utterance(self) -> AudioUtterance | None:
        """Snapshot of the in-progress utterance for provisional ASR.

        Non-destructive: the active buffer keeps accumulating, and the
        snapshot shares the utterance_id with the final utterance that
        `_finish` will produce for the same speech. Only the VAD thread
        calls this, so no locking is needed.
        """
        if self._active is None:
            return None
        samples = tuple(self._active)
        started_ns = self._active_started_sample * 1_000_000_000 // SAMPLE_RATE
        ended_ns = (self._active_started_sample + len(samples)) * 1_000_000_000 // SAMPLE_RATE
        return AudioUtterance(
            utterance_id=f"clip-utterance-{self._utterance_sequence + 1}",
            pcm_f32=samples,
            sample_rate=SAMPLE_RATE,
            started_ns=started_ns,
            ended_ns=ended_ns,
            is_final=False,
            forced_end=False,
        )

    def _feed_frame(self, frame: tuple[float, ...]) -> AudioUtterance | None:
        frame_start = self._total_samples
        self._total_samples += len(frame)
        is_speech = self._speech_detector.is_speech(frame)

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
                self._active_started_sample = max(0, frame_start + len(frame) - len(self._active))
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
            self._speech_frames = max(0, self.config.min_speech_ms // self.config.frame_ms - 1)
        return AudioUtterance(
            utterance_id=f"clip-utterance-{self._utterance_sequence}",
            pcm_f32=samples,
            sample_rate=SAMPLE_RATE,
            started_ns=started_ns,
            ended_ns=ended_ns,
            is_final=True,
            forced_end=forced,
        )
