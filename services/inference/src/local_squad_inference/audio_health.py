"""Source audio health: deterministic states, conservative normalization,
and rule-based calibration recommendations (DS-301/DS-302/DS-402).

All thresholds live in this module so the classification is deterministic
and testable. No raw audio is ever stored.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# --- DS-302: conservative normalization ------------------------------------

MAX_NORMALIZATION_GAIN_DB = 12.0
NORMALIZATION_TARGET_RMS = 0.05
QUIET_RMS = 0.008


def normalize_audio(
    samples: tuple[float, ...],
    *,
    enabled: bool,
    max_gain_db: float = MAX_NORMALIZATION_GAIN_DB,
) -> tuple[tuple[float, ...], bool]:
    """Light gain for quiet speech. Never touches non-finite samples, never
    amplifies already-loud input, never hard-clips. Returns
    ``(samples, applied)`` so callers can record whether processing ran."""
    if not enabled or not samples:
        return samples, False
    rms = _rms(samples)
    if not math.isfinite(rms) or rms <= 0.0:
        return samples, False
    if rms >= QUIET_RMS:
        return samples, False
    gain = min(NORMALIZATION_TARGET_RMS / rms, 10 ** (max_gain_db / 20.0))
    if gain <= 1.0:
        return samples, False
    return tuple(max(-1.0, min(1.0, sample * gain)) for sample in samples), True


# --- DS-300: per-source audio health metrics --------------------------------


@dataclass
class AudioHealthMetrics:
    """Cheap per-source signal statistics computed in the VAD feed path."""

    frames: int = 0
    rms_sum: float = 0.0
    peak: float = 0.0
    clipping_samples: int = 0
    zero_samples: int = 0
    non_finite_samples: int = 0
    speech_frames: int = 0
    packets_received: int = 0
    packets_dropped: int = 0
    queue_depth: int = 0
    forced_split_count: int = 0
    empty_high_speech_count: int = 0
    short_fragment_count: int = 0
    rapid_segment_count: int = 0
    open_utterance_ms: int = 0
    last_utterance_ms: int = 0
    last_speech_frame_ms: int = 0
    trailing_silence_ms: int = 0

    def observe_frame(self, samples: tuple[float, ...], *, speech: bool) -> None:
        self.frames += 1
        if speech:
            self.speech_frames += 1
        if not samples:
            return
        sample_sum = 0.0
        for sample in samples:
            if not math.isfinite(sample):
                self.non_finite_samples += 1
                continue
            abs_sample = abs(sample)
            sample_sum += sample * sample
            if abs_sample > self.peak:
                self.peak = abs_sample
            if abs_sample >= 0.99:
                self.clipping_samples += 1
            if abs_sample < 1e-6:
                self.zero_samples += 1
        self.rms_sum += sample_sum

    def snapshot(self) -> dict[str, object]:
        rms = _rms_from_sum(self.rms_sum, self.frames * 160)
        frames = self.frames
        zero_ratio = 0.0
        clipping_ratio = 0.0
        frames_ratio = 0.0
        total = self.frames * 160
        if total > 0:
            zero_ratio = self.zero_samples / total
            clipping_ratio = self.clipping_samples / total
            frames_ratio = self.speech_frames / max(1, self.frames)
        return {
            "frames": frames,
            "rms": rms,
            "peak": self.peak,
            "clipping_ratio": clipping_ratio,
            "zero_ratio": zero_ratio,
            "non_finite_samples": self.non_finite_samples,
            "speech_frame_ratio": frames_ratio,
            "packets_received": self.packets_received,
            "packets_dropped": self.packets_dropped,
            "queue_depth": self.queue_depth,
            "forced_split_count": self.forced_split_count,
            "empty_high_speech_count": self.empty_high_speech_count,
            "short_fragment_count": self.short_fragment_count,
            "rapid_segment_count": self.rapid_segment_count,
            "open_utterance_ms": self.open_utterance_ms,
            "last_utterance_ms": self.last_utterance_ms,
            "trailing_silence_ms": self.trailing_silence_ms,
        }


def _rms(samples: tuple[float, ...]) -> float:
    if not samples:
        return 0.0
    return _rms_from_sum(sum(sample * sample for sample in samples), len(samples))


def _rms_from_sum(sum_of_squares: float, count: int) -> float:
    if count <= 0 or not math.isfinite(sum_of_squares):
        return 0.0
    return math.sqrt(sum_of_squares / count)


# --- DS-301: source-health states -------------------------------------------

READY = "ready"
SILENT = "silent"
VERY_QUIET = "very_quiet"
CLIPPING = "clipping"
FORMAT_ERROR = "format_error"
OVERLOADED = "overloaded"
DISCONNECTED = "disconnected"
MONITORING_LOOP = "monitoring_loop_suspected"

SILENT_FRAME_LIMIT = 400  # ~8 s of 20 ms frames without any speech
VERY_QUIET_RMS = 0.004
CLIPPING_RATIO_LIMIT = 0.02
QUEUE_DEPTH_LIMIT = 6
ZERO_RATIO_LIMIT = 0.95

HEALTH_STATES: tuple[str, ...] = (
    READY,
    SILENT,
    VERY_QUIET,
    CLIPPING,
    FORMAT_ERROR,
    OVERLOADED,
    DISCONNECTED,
    MONITORING_LOOP,
)

_HEALTH_EXPLANATIONS: dict[str, tuple[str, str]] = {
    READY: ("Audio is healthy.", "No action needed."),
    SILENT: (
        "No speech detected for a while.",
        "Check that the application routes audio to the selected endpoint.",
    ),
    VERY_QUIET: (
        "Signal is very quiet.",
        "Raise the application output volume or enable light normalization.",
    ),
    CLIPPING: (
        "Signal is clipping.",
        "Lower the application output volume.",
    ),
    FORMAT_ERROR: (
        "Unexpected audio format.",
        "Re-select the endpoint or restart the session.",
    ),
    OVERLOADED: (
        "The pipeline is overloaded and shedding provisional work.",
        "Use a lighter quality profile or fewer concurrent sources.",
    ),
    DISCONNECTED: (
        "The endpoint stopped delivering audio.",
        "Check the device and re-select it if needed.",
    ),
    MONITORING_LOOP: (
        "Monitoring may be feeding the captured signal back.",
        "Pick a different monitoring output or turn monitoring off.",
    ),
}


@dataclass(frozen=True)
class SourceHealthState:
    state: str
    explanation: str
    recommended_action: str
    priority: int

    def to_dict(self) -> dict[str, str]:
        return {
            "state": self.state,
            "explanation": self.explanation,
            "recommended_action": self.recommended_action,
        }


def classify_source_health(
    health: AudioHealthMetrics,
    *,
    format_error: bool = False,
    disconnected: bool = False,
    monitoring_loop: bool = False,
) -> SourceHealthState:
    """Deterministic classification; the highest-priority problem wins."""
    problems: list[SourceHealthState] = []

    def problem(state: str, priority: int) -> None:
        explanation, action = _HEALTH_EXPLANATIONS[state]
        problems.append(SourceHealthState(state, explanation, action, priority=priority))

    if format_error:
        problem(FORMAT_ERROR, 100)
    if disconnected:
        problem(DISCONNECTED, 90)
    if monitoring_loop:
        problem(MONITORING_LOOP, 85)
    if health.non_finite_samples > 0:
        problem(FORMAT_ERROR, 80)
    if health.queue_depth >= QUEUE_DEPTH_LIMIT:
        problem(OVERLOADED, 70)
    if health.frames >= SILENT_FRAME_LIMIT and health.speech_frames == 0:
        problem(SILENT, 60)
    if (
        health.frames > 0
        and health.rms_sum > 0
        and _rms_from_sum(health.rms_sum, health.frames * 160) < VERY_QUIET_RMS
    ):
        problem(VERY_QUIET, 50)
    if health.frames > 0 and (
        health.clipping_samples / (health.frames * 160) >= CLIPPING_RATIO_LIMIT
    ):
        problem(CLIPPING, 40)
    if health.frames > 0 and health.zero_samples / (health.frames * 160) >= ZERO_RATIO_LIMIT:
        problem(SILENT, 30)
    if not problems:
        return SourceHealthState(READY, *_HEALTH_EXPLANATIONS[READY], priority=0)
    return max(problems, key=lambda item: item.priority)


# --- DS-402: calibration recommendations ------------------------------------

SHORT_FRAGMENT_LIMIT = 5
RAPID_SEGMENT_LIMIT = 6
SHORT_FRAGMENT_MS = 400
RAPID_GAP_MS = 500


def calibration_recommendations(
    health: AudioHealthMetrics,
    *,
    high_speech_empty: bool = False,
) -> list[str]:
    """Deterministic rules -> recommendation strings (never generated
    text). Ordered by likely impact; empty when nothing needs tuning."""
    recommendations: list[str] = []
    if health.short_fragment_count >= SHORT_FRAGMENT_LIMIT:
        recommendations.append(
            "Many short fragments — increase the end-silence duration "
            "(or use the natural-conversation VAD profile)."
        )
    if health.forced_split_count >= 3:
        recommendations.append(
            "Frequent forced splits — increase the maximum utterance "
            "length or use the Meeting preset."
        )
    if high_speech_empty or health.empty_high_speech_count >= 2:
        recommendations.append(
            "High speech probability with empty transcripts — inspect the "
            "ASR language/model before changing VAD settings."
        )
    if health.frames > 0 and _rms_from_sum(health.rms_sum, health.frames * 160) < VERY_QUIET_RMS:
        recommendations.append(
            "Very quiet input — raise the application output or enable light normalization."
        )
    if health.trailing_silence_ms > 0 and health.short_fragment_count >= SHORT_FRAGMENT_LIMIT:
        recommendations.append("Repeated clipped beginnings — increase the pre-roll duration.")
    return recommendations


# --- DS-303: source-origin processing policy ---------------------------------


@dataclass(frozen=True)
class SourceProcessingPolicy:
    """Resolved processing defaults per source origin (all concrete)."""

    normalize: bool = False
    additional_suppression: bool = False
    echo_handling: bool = False
    strict_speech_validation: bool = False
    vad_enabled: bool = True


@dataclass(frozen=True)
class ProcessingOverrides:
    """Explicit user overrides; `None` means "use the origin default" so
    an explicit False can win over a True default."""

    normalize: bool | None = None
    additional_suppression: bool | None = None
    echo_handling: bool | None = None
    strict_speech_validation: bool | None = None
    vad_enabled: bool | None = None


SOURCE_ORIGIN_POLICIES: dict[str, SourceProcessingPolicy] = {
    "virtual_voice_channel": SourceProcessingPolicy(normalize=False),
    "physical_microphone": SourceProcessingPolicy(normalize=True),
    "application_audio": SourceProcessingPolicy(normalize=False),
    "system_mix": SourceProcessingPolicy(normalize=False, strict_speech_validation=True),
    "recorded_file": SourceProcessingPolicy(normalize=False, vad_enabled=False),
}

DEFAULT_ORIGIN_POLICY = SourceProcessingPolicy(normalize=False)


def policy_for_origin(source_origin: str) -> SourceProcessingPolicy:
    return SOURCE_ORIGIN_POLICIES.get(source_origin, DEFAULT_ORIGIN_POLICY)


def resolve_processing_policy(
    source_origin: str,
    *,
    overrides: ProcessingOverrides | None = None,
) -> SourceProcessingPolicy:
    """Origin defaults, then explicit user overrides (None = default)."""
    base = policy_for_origin(source_origin)
    if overrides is None:
        return base
    return SourceProcessingPolicy(
        normalize=(overrides.normalize if overrides.normalize is not None else base.normalize),
        additional_suppression=(
            overrides.additional_suppression
            if overrides.additional_suppression is not None
            else base.additional_suppression
        ),
        echo_handling=(
            overrides.echo_handling if overrides.echo_handling is not None else base.echo_handling
        ),
        strict_speech_validation=(
            overrides.strict_speech_validation
            if overrides.strict_speech_validation is not None
            else base.strict_speech_validation
        ),
        vad_enabled=(
            overrides.vad_enabled if overrides.vad_enabled is not None else base.vad_enabled
        ),
    )
