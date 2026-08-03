"""Phase 6: shared bounded inference scheduler (spec §7).

Priority rules, provisional coalescing, overload handling, queue-delay
measurement, and the rename-safety of scheduling (priority comes from
the immutable source id, never from names or tags).
"""

from __future__ import annotations

import time

from local_squad_inference.scheduler import (
    InferenceScheduler,
    make_job,
)
from local_squad_inference.vad import AudioUtterance

TEAM = "11111111111111111111111111111111"
DISCORD = "22222222222222222222222222222222"
BROWSER = "33333333333333333333333333333333"


def utterance(utterance_id: str, source_id: str | None, *, final: bool = True) -> AudioUtterance:
    return AudioUtterance(
        utterance_id=utterance_id,
        pcm_f32=tuple([0.25] * 320),
        sample_rate=16_000,
        started_ns=0,
        ended_ns=320_000_000 if final else 100_000_000,
        is_final=final,
        forced_end=False,
        source_id=source_id,
    )


def final_job(
    source_id: str | None,
    utterance_id: str,
    *,
    priority: int = 100,
    created_ns: int | None = None,
) -> object:
    return make_job(
        utterance(utterance_id, source_id),
        is_final=True,
        revision=0,
        priority=priority,
        created_monotonic_ns=created_ns,
    )


def provisional_job(
    source_id: str | None,
    utterance_id: str,
    *,
    revision: int,
    priority: int = 100,
) -> object:
    return make_job(
        utterance(utterance_id, source_id, final=False),
        is_final=False,
        revision=revision,
        priority=priority,
    )


def drain(scheduler: InferenceScheduler) -> list[object]:
    jobs: list[object] = []
    while True:
        job = scheduler.take(timeout=0.01)
        if job is None:
            return jobs
        jobs.append(job)


def test_final_jobs_beat_provisionals_and_oldest_final_first() -> None:
    scheduler = InferenceScheduler()
    scheduler.submit(provisional_job(TEAM, "u1", revision=2))
    scheduler.submit(final_job(TEAM, "u2", created_ns=1_000))
    scheduler.submit(final_job(DISCORD, "u3", created_ns=2_000))
    jobs = drain(scheduler)
    assert [job.utterance_id for job in jobs] == ["u2", "u3", "u1"]


def test_higher_source_priority_decodes_first_within_tier() -> None:
    scheduler = InferenceScheduler()
    scheduler.submit(final_job(DISCORD, "d1", priority=100, created_ns=1_000))
    scheduler.submit(final_job(TEAM, "t1", priority=200, created_ns=5_000))
    scheduler.submit(final_job(BROWSER, "b1", priority=50, created_ns=2_000))
    jobs = drain(scheduler)
    assert [job.utterance_id for job in jobs] == ["t1", "d1", "b1"]


def test_provisional_coalescing_keeps_newest_revision_only() -> None:
    scheduler = InferenceScheduler()
    scheduler.submit(provisional_job(TEAM, "u1", revision=1))
    scheduler.submit(provisional_job(TEAM, "u1", revision=2))
    scheduler.submit(provisional_job(TEAM, "u1", revision=3))
    scheduler.submit(provisional_job(DISCORD, "u2", revision=1))
    jobs = drain(scheduler)
    assert [job.utterance_id for job in jobs] == ["u2", "u1"]
    assert jobs[1].revision == 3
    metrics = scheduler.metrics()
    assert metrics.provisionals_submitted == 4
    assert metrics.provisionals_coalesced == 2
    assert metrics.provisionals_completed == 2


def test_stale_revision_never_replaces_newer_queued_provisional() -> None:
    scheduler = InferenceScheduler()
    scheduler.submit(provisional_job(TEAM, "u1", revision=5))
    scheduler.submit(provisional_job(TEAM, "u1", revision=3))
    jobs = drain(scheduler)
    assert len(jobs) == 1
    assert jobs[0].revision == 5


def test_provisionals_refused_at_high_water_and_overload_reported() -> None:
    scheduler = InferenceScheduler(
        max_queued=4, provisional_high_water=3, resource_policy="maximum_accuracy"
    )
    for index in range(3):
        assert scheduler.submit(final_job(TEAM, f"f{index}"))
    refused = scheduler.submit(provisional_job(DISCORD, "p1", revision=1))
    assert refused is False
    metrics = scheduler.metrics()
    assert metrics.provisionals_dropped == 1
    assert metrics.overload_events == 1
    assert metrics.provisionals_completed == 0
    scheduler.close()


def test_finals_are_never_dropped_silently() -> None:
    scheduler = InferenceScheduler(max_queued=2)
    for index in range(2):
        assert scheduler.submit(final_job(TEAM, f"old-{index}", created_ns=index))
    # The queue is full of finals: the next final must not be refused.
    assert scheduler.submit(final_job(TEAM, "new-1", created_ns=99)) is True
    metrics = scheduler.metrics()
    assert metrics.finals_dropped == 1
    assert metrics.overload_events == 1
    # The newest final survives; the oldest evicted final is gone but counted.
    jobs = drain(scheduler)
    assert [job.utterance_id for job in jobs] == ["old-1", "new-1"]


def test_final_submission_drops_queued_provisionals_to_make_room() -> None:
    scheduler = InferenceScheduler(max_queued=3, provisional_high_water=4)
    scheduler.submit(provisional_job(DISCORD, "p1", revision=1))
    scheduler.submit(provisional_job(DISCORD, "p2", revision=1))
    scheduler.submit(final_job(TEAM, "f1", created_ns=1))
    # Full: the final evicts every queued provisional first, then lands.
    assert scheduler.submit(final_job(TEAM, "f2", created_ns=2)) is True
    metrics = scheduler.metrics()
    assert metrics.provisionals_dropped == 2
    assert metrics.finals_dropped == 0
    jobs = drain(scheduler)
    assert [job.utterance_id for job in jobs] == ["f1", "f2"]


def test_queue_delay_is_measured_separately_from_inference() -> None:
    scheduler = InferenceScheduler()
    past_ns = time.monotonic_ns() - 250_000_000
    scheduler.submit(final_job(TEAM, "u1", created_ns=past_ns))
    job = scheduler.take(timeout=0.01)
    assert job is not None
    metrics = scheduler.metrics()
    assert metrics.avg_queue_delay_ms >= 200
    assert metrics.max_queue_delay_ms >= 200
    assert metrics.queue_depth == 0


def test_renaming_a_source_never_changes_scheduling() -> None:
    scheduler = InferenceScheduler()
    # Same immutable source id regardless of any display name/tag edits.
    first = make_job(
        utterance("u1", TEAM),
        is_final=True,
        revision=0,
        priority=100,
        created_monotonic_ns=1_000,
    )
    later = make_job(
        utterance("u2", TEAM),
        is_final=True,
        revision=0,
        priority=100,
        created_monotonic_ns=2_000,
    )
    renamed = make_job(
        utterance("u3", TEAM),
        is_final=True,
        revision=0,
        priority=100,
        created_monotonic_ns=3_000,
    )
    scheduler.submit(renamed)
    scheduler.submit(first)
    scheduler.submit(later)
    jobs = drain(scheduler)
    # Oldest first, all from the same immutable source id.
    assert [job.utterance_id for job in jobs] == ["u1", "u2", "u3"]


def test_close_unblocks_takes_and_discards_pending() -> None:
    scheduler = InferenceScheduler()
    scheduler.submit(final_job(TEAM, "u1"))
    scheduler.close()
    assert scheduler.take(timeout=0.01) is None
    assert scheduler.metrics().queue_depth == 0


def test_maximum_accuracy_never_throttles_provisionals() -> None:
    scheduler = InferenceScheduler(resource_policy="maximum_accuracy")
    scheduler.submit(final_job(TEAM, "f1"))
    provisional = make_job(
        utterance("p1", DISCORD, final=False),
        is_final=False,
        revision=1,
        priority=100,
    )
    assert scheduler.submit(provisional) is True
    assert scheduler.metrics().provisionals_dropped == 0


def test_balanced_throttles_secondary_provisionals_when_final_queued() -> None:
    scheduler = InferenceScheduler(resource_policy="balanced")
    scheduler.submit(final_job(TEAM, "f1"))
    provisional = make_job(
        utterance("p1", DISCORD, final=False),
        is_final=False,
        revision=1,
        priority=100,
    )
    # A final is queued, so the secondary-source provisional is held.
    assert scheduler.submit(provisional) is False
    assert scheduler.metrics().provisionals_dropped == 1
    # No overload event: this is deliberate resource policy, not queue pressure.
    assert scheduler.metrics().overload_events == 0


def test_protect_game_performance_keeps_primary_provisional_only() -> None:
    scheduler = InferenceScheduler(resource_policy="protect_game_performance")
    # Primary source (TEAM, higher priority) final is queued.
    scheduler.submit(final_job(TEAM, "f1", priority=200))
    team_provisional = make_job(
        utterance("p-team", TEAM, final=False),
        is_final=False,
        revision=1,
        priority=200,
    )
    discord_provisional = make_job(
        utterance("p-discord", DISCORD, final=False),
        is_final=False,
        revision=1,
        priority=100,
    )
    assert scheduler.submit(team_provisional) is True  # primary keeps provisional
    assert scheduler.submit(discord_provisional) is False  # secondary held
    assert scheduler.metrics().provisionals_dropped == 1


def test_policy_switches_at_runtime() -> None:
    scheduler = InferenceScheduler(resource_policy="maximum_accuracy")
    scheduler.submit(final_job(TEAM, "f1"))
    scheduler.set_resource_policy("balanced")
    provisional = make_job(
        utterance("p1", DISCORD, final=False),
        is_final=False,
        revision=1,
        priority=100,
    )
    assert scheduler.submit(provisional) is False  # now throttled
    assert scheduler.metrics().provisionals_dropped == 1
