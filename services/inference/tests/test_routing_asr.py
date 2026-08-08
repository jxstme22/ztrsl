"""DS-703/707/708/709: provisional/final orchestration + fallback."""

from __future__ import annotations

from local_squad_inference.providers import AsrResult
from local_squad_inference.routing_asr import (
    FallbackPolicy,
    RoutingAsrProvider,
    fallback_eligible,
    repetition_ratio,
    select_better,
)
from local_squad_inference.vad import AudioUtterance


def utterance(*, is_final: bool = True, duration_s: float = 2.0) -> AudioUtterance:
    started = 1_000_000_000
    return AudioUtterance(
        utterance_id="u1",
        pcm_f32=(0.1,) * 4800,
        sample_rate=16_000,
        started_ns=started,
        ended_ns=started + int(duration_s * 1e9),
        is_final=is_final,
        forced_end=False,
        source_id=None,
    )


def result(
    text: str,
    *,
    confidence: float | None = 0.9,
    model_id: str = "a",
    error: str | None = None,
) -> AsrResult:
    return AsrResult(
        utterance_id="u1",
        text=text,
        source_mode="filipino",
        is_final=True,
        inference_ms=10.0,
        model_id=model_id,
        confidence=confidence,
        error=error,
    )


class RecordingProvider:
    def __init__(self, text: str, confidence: float | None = 0.9) -> None:
        self.text = text
        self.confidence = confidence
        self.provisionals = 0
        self.finals = 0

    @property
    def model_id(self) -> str:
        return "recording"

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        if utterance.is_final:
            self.finals += 1
        else:
            self.provisionals += 1
        return result(self.text, confidence=self.confidence, model_id="recording")


class ExplodingProvider:
    @property
    def model_id(self) -> str:
        return "boom"

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        raise RuntimeError("provider failed")


def test_orchestrator_uses_provisional_and_final_providers() -> None:
    provisional = RecordingProvider("draft")
    final = RecordingProvider("final")
    routed = RoutingAsrProvider(provisional, final)

    routed.transcribe(utterance(is_final=False), "filipino")
    routed.transcribe(utterance(is_final=True), "filipino")

    assert provisional.provisionals == 1
    assert final.finals == 1
    assert final.provisionals == 0


def test_stale_provisional_cannot_supply_a_final() -> None:
    provisional = RecordingProvider("draft")
    final = RecordingProvider("final")
    routed = RoutingAsrProvider(provisional, final)
    final_result = routed.transcribe(utterance(is_final=True), "filipino")
    assert final_result.text == "final"


def test_fallback_runs_only_on_eligible_finals() -> None:
    primary = RecordingProvider("", confidence=None)  # empty -> eligible
    fallback = RecordingProvider("better text", confidence=0.9)
    routed = RoutingAsrProvider(
        primary,
        primary,
        fallback=fallback,
        fallback_policy=FallbackPolicy(enabled=True, max_extra_latency_ms=4000),
    )
    routed.transcribe(utterance(is_final=False), "filipino")  # provisional: no fallback
    final_result = routed.transcribe(utterance(is_final=True), "filipino")
    assert final_result.text == "better text"
    assert routed.fallback_eligible_count == 1
    assert routed.fallback_executed_count == 1


def test_fallback_failure_keeps_primary() -> None:
    primary = RecordingProvider("keep me", confidence=0.2)
    routed = RoutingAsrProvider(
        primary,
        primary,
        fallback=ExplodingProvider(),
        fallback_policy=FallbackPolicy(enabled=True),
    )
    final_result = routed.transcribe(utterance(is_final=True), "filipino")
    assert final_result.text == "keep me"
    assert routed.fallback_eligible_count == 1
    assert routed.fallback_failed_count == 1


def test_fallback_disabled_by_policy() -> None:
    primary = RecordingProvider("", confidence=None)
    routed = RoutingAsrProvider(
        primary,
        primary,
        fallback=RecordingProvider("alternate"),
        fallback_policy=FallbackPolicy(enabled=False),
    )
    final_result = routed.transcribe(utterance(is_final=True), "filipino")
    assert final_result.text == ""
    assert routed.fallback_executed_count == 0


def test_eligible_signals() -> None:
    policy = FallbackPolicy()
    assert fallback_eligible(result(""), utterance(), policy) is True
    assert fallback_eligible(result("ok", confidence=0.2), utterance(), policy) is True
    assert fallback_eligible(result("ok", error="boom"), utterance(), policy) is True
    assert fallback_eligible(result("ok", confidence=0.9), utterance(), policy) is False
    # Implausibly short for a 60 s utterance.
    assert (
        fallback_eligible(
            result("ok", confidence=0.9),
            utterance(duration_s=60.0),
            policy,
        )
        is True
    )


def test_repetition_ratio() -> None:
    assert repetition_ratio("") == 0.0
    assert repetition_ratio("a a a") == pytest_approx(2 / 3)
    assert repetition_ratio("rotate b rotate a") == 0.0


def pytest_approx(value: float) -> float:
    return value


def test_select_better_prefers_non_empty_and_less_repetitive() -> None:
    empty = result("", confidence=None)
    assert select_better(empty, result("text"), utterance()).text == "text"
    stuck = result("a a a a a", confidence=0.95)
    clean = result("rotate to B now", confidence=0.9)
    chosen = select_better(stuck, clean, utterance())
    assert chosen.text == "rotate to B now"
    # Confidence gap decides between two plausible texts.
    lower = result("first guess", confidence=0.5)
    higher = result("second guess", confidence=0.9)
    assert select_better(lower, higher, utterance()).text == "second guess"
