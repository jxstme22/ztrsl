"""DS-703/708/709: provisional/final provider orchestration + fallback.

Wraps existing AsrProviders: a primary provider serves provisional
decodes, a final provider (possibly the same instance) serves finals, and
optional fallback decode eligibility/selection lives here so provider
interfaces stay untouched.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from local_squad_inference.providers import AsrProvider, AsrResult
from local_squad_inference.vad import AudioUtterance


@dataclass(frozen=True)
class FallbackPolicy:
    """DS-707/708: when fallback is allowed and how to decide."""

    enabled: bool = True
    max_extra_latency_ms: int = 4000
    confidence_threshold: float = 0.35
    max_repetition_ratio: float = 0.6
    min_plausible_cpm: float = 3.0  # chars per minute of audio


class RoutingAsrProvider(AsrProvider):
    """Provisional provider A, final provider B, optional fallback.

    A provisional result is always replaceable; a final result is terminal.
    Fallback runs only on finals, keeps the primary result on failure, and
    never emits two competing finals.
    """

    def __init__(
        self,
        provisional: AsrProvider,
        final: AsrProvider,
        *,
        fallback: AsrProvider | None = None,
        fallback_policy: FallbackPolicy | None = None,
    ) -> None:
        self._provisional = provisional
        self._final = final
        self._fallback = fallback
        self._fallback_policy = fallback_policy or FallbackPolicy()
        self.fallback_eligible_count = 0
        self.fallback_executed_count = 0
        self.fallback_failed_count = 0

    @property
    def model_id(self) -> str:
        return str(getattr(self._final, "model_id", "routing-asr"))

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        if not utterance.is_final:
            return self._provisional.transcribe(utterance, source_mode)
        primary = self._final.transcribe(utterance, source_mode)
        if not fallback_eligible(primary, utterance, self._fallback_policy):
            return primary
        if self._fallback is None or not self._fallback_policy.enabled:
            return primary
        self.fallback_eligible_count += 1
        if fallback_execution_blocked(primary, self._fallback_policy):
            return primary
        started = time.perf_counter()
        try:
            alternate = self._fallback.transcribe(utterance, source_mode)
        except Exception:
            self.fallback_failed_count += 1
            return primary
        self.fallback_executed_count += 1
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        if elapsed_ms > self._fallback_policy.max_extra_latency_ms:
            return primary
        return select_better(primary, alternate, utterance)


# --- DS-707: fallback eligibility --------------------------------------------


def fallback_eligible(
    result: AsrResult,
    utterance: AudioUtterance,
    policy: FallbackPolicy,
) -> bool:
    if not result.text:
        return True  # empty transcript with strong VAD evidence
    if result.error is not None:
        return True  # provider error
    confidence = result.confidence
    if confidence is not None and confidence < policy.confidence_threshold:
        return True
    duration_s = max(0.001, (utterance.ended_ns - utterance.started_ns) / 1e9)
    chars = len(result.text)
    if chars / (duration_s / 60.0) < policy.min_plausible_cpm:
        return True  # implausibly short for the utterance length
    return repetition_ratio(result.text) >= policy.max_repetition_ratio


def repetition_ratio(text: str) -> float:
    """Ratio of repeated adjacent tokens; ~1.0 for stuck decoders."""
    tokens = text.lower().split()
    if len(tokens) < 3:
        return 0.0
    repeats = sum(1 for index in range(1, len(tokens)) if tokens[index] == tokens[index - 1])
    return repeats / len(tokens)


def fallback_execution_blocked(primary: AsrResult, policy: FallbackPolicy) -> bool:
    """Deterministic guard: never run fallback on non-finals (finals only
    reach this point) or when the primary already looks good."""
    return primary.confidence is not None and primary.confidence >= 0.8


# --- DS-709: primary vs fallback selection -----------------------------------


def select_better(
    primary: AsrResult,
    alternate: AsrResult,
    utterance: AudioUtterance,
) -> AsrResult:
    """Coarse, deterministic choice. Confidences from unrelated model
    families are not calibrated against each other, so the decision uses
    orderable signals: non-empty text, then repetition, then confidence."""
    if not primary.text and alternate.text:
        return _with_model(alternate, primary.model_id)
    if not alternate.text:
        return primary
    if repetition_ratio(alternate.text) < repetition_ratio(primary.text) - 0.2:
        return _with_model(alternate, primary.model_id)
    primary_conf = primary.confidence if primary.confidence is not None else 0.0
    alternate_conf = alternate.confidence if alternate.confidence is not None else 0.0
    if alternate_conf > primary_conf + 0.1:
        return _with_model(alternate, primary.model_id)
    return primary


def _with_model(result: AsrResult, model_id: str) -> AsrResult:
    return AsrResult(
        utterance_id=result.utterance_id,
        text=result.text,
        source_mode=result.source_mode,
        is_final=result.is_final,
        inference_ms=result.inference_ms,
        model_id=model_id,
        confidence=result.confidence,
        language=result.language,
        error=result.error,
    )


def duration_ms(utterance: AudioUtterance) -> int:
    return max(0, int((utterance.ended_ns - utterance.started_ns) // 1_000_000))
