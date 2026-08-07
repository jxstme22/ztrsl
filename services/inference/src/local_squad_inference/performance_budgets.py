"""DS-1003: performance budgets per quality profile and hardware class.

Warnings fire when a user selects a configuration outside the recommended
class. These are documentation-grade budgets used by the UI/diagnostics,
not hard limits.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PerformanceBudget:
    quality_profile_id: str
    max_provisional_cadence_ms: int
    target_final_latency_ms: int
    queue_capacity: int
    supported_concurrent_sources: int
    max_loaded_models: int
    memory_budget_mb: int


PERFORMANCE_BUDGETS: dict[str, PerformanceBudget] = {
    "fast": PerformanceBudget(
        quality_profile_id="fast",
        max_provisional_cadence_ms=400,
        target_final_latency_ms=1500,
        queue_capacity=4,
        supported_concurrent_sources=4,
        max_loaded_models=1,
        memory_budget_mb=2048,
    ),
    "balanced": PerformanceBudget(
        quality_profile_id="balanced",
        max_provisional_cadence_ms=600,
        target_final_latency_ms=3000,
        queue_capacity=6,
        supported_concurrent_sources=4,
        max_loaded_models=2,
        memory_budget_mb=4096,
    ),
    "best_quality": PerformanceBudget(
        quality_profile_id="best_quality",
        max_provisional_cadence_ms=1000,
        target_final_latency_ms=6000,
        queue_capacity=8,
        supported_concurrent_sources=2,
        max_loaded_models=2,
        memory_budget_mb=8192,
    ),
    "low_memory": PerformanceBudget(
        quality_profile_id="low_memory",
        max_provisional_cadence_ms=1200,
        target_final_latency_ms=5000,
        queue_capacity=4,
        supported_concurrent_sources=2,
        max_loaded_models=1,
        memory_budget_mb=1024,
    ),
}


def budget_for(quality_profile_id: str) -> PerformanceBudget:
    budget = PERFORMANCE_BUDGETS.get(quality_profile_id)
    if budget is None:
        raise ValueError(f"unknown quality profile: {quality_profile_id}")
    return budget


def budget_warnings(
    quality_profile_id: str,
    *,
    concurrent_sources: int,
    loaded_models: int,
) -> list[str]:
    """Deterministic warnings when a selection exceeds the recommended
    class. Never blocks; surfaces in diagnostics/UI."""
    budget = budget_for(quality_profile_id)
    warnings: list[str] = []
    if concurrent_sources > budget.supported_concurrent_sources:
        warnings.append(
            f"{concurrent_sources} sources exceed the {budget.quality_profile_id} "
            f"budget ({budget.supported_concurrent_sources}); expect higher latency."
        )
    if loaded_models > budget.max_loaded_models:
        warnings.append(
            f"{loaded_models} loaded models exceed the {budget.quality_profile_id} "
            f"budget ({budget.max_loaded_models}); memory may be tight."
        )
    return warnings
