"""Shared bounded inference scheduler (spec §7).

One scheduler instance serves every source's VAD output, so ASR and
translation models are loaded once per process instead of once per
source (the "shared VRAM" acceptance criterion). Scheduling uses only
immutable source ids and a per-source priority — never display names
or tags.

Priority rules (§7.2): final jobs before provisional jobs; within one
kind, higher source priority first; oldest final first; a newer
provisional revision replaces an older queued provisional for the same
source/utterance (latest-wins coalescing, at most one queued).

Overload (§7.3): on pressure the scheduler drops stale provisional
jobs, refuses new provisionals at high water ("pause secondary
provisional decoding"), never drops finals silently (they drop only as
a last resort and are counted and reported as overload), and exposes
metrics for the `scheduler.metrics` / `scheduler.overloaded` wire
events.
"""

from __future__ import annotations

import heapq
import threading
import time
from dataclasses import dataclass
from typing import Literal

from local_squad_inference.vad import AudioUtterance

DEFAULT_SOURCE_PRIORITY = 100
FINAL_RANK = 0
PROVISIONAL_RANK = 1

# v0.4 adaptive scheduling resource policy (§11): how aggressively the
# scheduler throttles provisional decoding under pressure.
# - maximum_accuracy: provisionals always allowed (v0.3 behavior).
# - balanced: provisionals allowed, but secondary sources fall back to
#   finals-only once any final is queued.
# - protect_game_performance: finals-only for secondary sources whenever a
#   final is queued (TEAM's own provisionals are preserved).
ResourcePolicy = Literal["maximum_accuracy", "balanced", "protect_game_performance"]

DEFAULT_RESOURCE_POLICY: ResourcePolicy = "balanced"


@dataclass(frozen=True, order=True)
class InferenceJob:
    """One schedulable decode unit (spec §7.1).

    `sort_key` is `(-priority, kind_rank, tie_break)`: higher priority
    first; finals (rank 0) before provisionals (rank 1); within one
    kind, oldest final first but newest provisional first (the
    tie_break is negated for provisionals as a backstop behind
    coalescing).
    """

    sort_key: tuple[int, int, int]
    source_id: str | None
    utterance_id: str
    revision: int
    priority: int
    is_final: bool
    created_monotonic_ns: int
    language_profile_id: str
    utterance: AudioUtterance


def make_job(
    utterance: AudioUtterance,
    *,
    priority: int = DEFAULT_SOURCE_PRIORITY,
    is_final: bool,
    revision: int,
    created_monotonic_ns: int | None = None,
    language_profile_id: str = "auto",
) -> InferenceJob:
    """Build a job whose sort key encodes the spec's ordering rules."""
    created = created_monotonic_ns if created_monotonic_ns is not None else time.monotonic_ns()
    rank = FINAL_RANK if is_final else PROVISIONAL_RANK
    tie_break = created if is_final else -created
    return InferenceJob(
        sort_key=(-priority, rank, tie_break),
        source_id=utterance.source_id,
        utterance_id=utterance.utterance_id,
        revision=revision,
        priority=priority,
        is_final=is_final,
        created_monotonic_ns=created,
        language_profile_id=language_profile_id,
        utterance=utterance,
    )


@dataclass(frozen=True)
class SchedulerMetrics:
    finals_submitted: int
    provisionals_submitted: int
    finals_completed: int
    provisionals_completed: int
    provisionals_coalesced: int
    provisionals_dropped: int
    finals_dropped: int
    overload_events: int
    queue_depth: int
    oldest_queued_ms: float
    avg_queue_delay_ms: float
    max_queue_delay_ms: float


class InferenceScheduler:
    """Thread-safe bounded priority scheduler for decode jobs.

    The VAD thread submits; the inference pool takes. `submit` never
    blocks the caller for long (a short bounded retry while the pool
    drains, never waiting on inference itself); `take` blocks the
    workers until a job is available or the scheduler is closed.
    """

    def __init__(
        self,
        *,
        max_queued: int = 8,
        provisional_high_water: int | None = None,
        resource_policy: ResourcePolicy = DEFAULT_RESOURCE_POLICY,
    ) -> None:
        if max_queued < 2:
            raise ValueError("max_queued must be at least 2")
        self._max_queued = max_queued
        self._high_water = provisional_high_water or max_queued - 2
        self._resource_policy = resource_policy
        self._heap: list[InferenceJob] = []
        self._provisional_slots: dict[tuple[str | None, str], InferenceJob] = {}
        self._closed = False
        self._lock = threading.Condition(threading.Lock())
        self._finals_submitted = 0
        self._provisionals_submitted = 0
        self._finals_completed = 0
        self._provisionals_completed = 0
        self._provisionals_coalesced = 0
        self._provisionals_dropped = 0
        self._finals_dropped = 0
        self._overload_events = 0
        self._queue_delay_total_ms = 0.0
        self._queue_delay_max_ms = 0.0
        self._queue_delay_samples = 0

    def set_resource_policy(self, policy: ResourcePolicy) -> None:
        """Switch the adaptive resource policy at runtime (hot, no restart)."""
        with self._lock:
            self._resource_policy = policy
            self._wake_all()

    # ---- submission ---------------------------------------------------

    def submit(self, job: InferenceJob) -> bool:
        """Queue one job. Finals are never dropped silently; provisionals
        are coalesced latest-wins and refused at high water. Returns True
        when the job was queued."""
        with self._lock:
            if self._closed:
                return False
            if job.is_final:
                return self._submit_final(job)
            return self._submit_provisional(job)

    def _submit_final(self, job: InferenceJob) -> bool:
        self._finals_submitted += 1
        if len(self._heap) < self._max_queued:
            self._push(job)
            return True
        # Overload step 1: drop every queued provisional to make room.
        dropped = self._drop_all_provisionals()
        if dropped:
            self._overload_events += 1
        if len(self._heap) < self._max_queued:
            self._push(job)
            return True
        # The pool is genuinely saturated; keep the newest final work by
        # dropping the oldest queued final. Never silent: counted and
        # reported via scheduler.overloaded.
        evicted = heapq.heapreplace(self._heap, job)
        self._finals_dropped += 1
        self._overload_events += 1
        self._evict_slot(evicted)
        self._wake_all()
        return True

    def _submit_provisional(self, job: InferenceJob) -> bool:
        self._provisionals_submitted += 1
        slot_key = (job.source_id, job.utterance_id)
        existing = self._provisional_slots.get(slot_key)
        if existing is not None:
            if existing.revision >= job.revision:
                return False
            self._heap[self._heap.index(existing)] = job
            self._provisional_slots[slot_key] = job
            heapq.heapify(self._heap)
            self._provisionals_coalesced += 1
            self._wake_all()
            return True
        # Adaptive scheduling (§11): under pressure, secondary sources fall
        # back to finals-only. A provisional from the highest-priority source
        # with queued work is preserved; the rest are throttled (counted, not
        # overload — this is deliberate resource policy, not queue pressure).
        if self._throttled(job):
            self._provisionals_dropped += 1
            return False
        # Overload step 2: pause secondary provisional decoding while the
        # queue sits at or above high water.
        if len(self._heap) >= self._high_water:
            self._provisionals_dropped += 1
            self._overload_events += 1
            return False
        if len(self._heap) >= self._max_queued:
            self._provisionals_dropped += 1
            return False
        self._push(job)
        return True

    def _throttled(self, job: InferenceJob) -> bool:
        """True when the resource policy should hold this provisional back.

        - maximum_accuracy: never throttled.
        - balanced: a secondary-source provisional is held while any final is
          queued (finals-only for secondary sources under pressure).
        - protect_game_performance: same as balanced, but the primary (highest
          priority queued) source keeps its provisionals.
        """
        if self._resource_policy == "maximum_accuracy":
            return False
        if not any(queued.is_final for queued in self._heap):
            return False
        if self._resource_policy == "balanced":
            return True
        # protect_game_performance: keep only the primary source's provisionals.
        primary = max(
            (queued for queued in self._heap if queued.is_final),
            key=lambda queued: queued.priority,
            default=None,
        )
        if primary is None:
            return False
        return job.priority < primary.priority

    def _push(self, job: InferenceJob) -> None:
        heapq.heappush(self._heap, job)
        if not job.is_final:
            self._provisional_slots[(job.source_id, job.utterance_id)] = job
        self._wake_all()

    def _evict_slot(self, job: InferenceJob) -> None:
        if not job.is_final:
            self._provisional_slots.pop((job.source_id, job.utterance_id), None)

    def _drop_all_provisionals(self) -> int:
        self._heap = [job for job in self._heap if job.is_final]
        heapq.heapify(self._heap)
        dropped = len(self._provisional_slots)
        self._provisionals_dropped += dropped
        self._provisional_slots.clear()
        return dropped

    # ---- consumption --------------------------------------------------

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    def take(self, timeout: float = 0.05) -> InferenceJob | None:
        """Pop the next job by priority. Returns None once closed (workers
        exit); with `closed=False` and no job it blocks up to `timeout`
        and returns None."""
        with self._lock:
            deadline = time.monotonic() + timeout
            while True:
                if self._closed:
                    return None
                if self._heap:
                    job = heapq.heappop(self._heap)
                    self._evict_slot(job)
                    if job.is_final:
                        self._finals_completed += 1
                    else:
                        self._provisionals_completed += 1
                    delay_ms = max(0.0, (time.monotonic_ns() - job.created_monotonic_ns) / 1e6)
                    self._queue_delay_total_ms += delay_ms
                    self._queue_delay_max_ms = max(self._queue_delay_max_ms, delay_ms)
                    self._queue_delay_samples += 1
                    self._wake_all()
                    return job
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._lock.wait(timeout=remaining)

    def close(self) -> None:
        """Close the scheduler: pending jobs are discarded and every
        blocked `take` returns None so the inference pool can exit."""
        with self._lock:
            self._closed = True
            self._heap.clear()
            self._provisional_slots.clear()
            self._wake_all()

    # ---- metrics ------------------------------------------------------

    def metrics(self) -> SchedulerMetrics:
        with self._lock:
            depth = len(self._heap)
            oldest_ms = 0.0
            if self._heap:
                oldest_job = min(self._heap, key=lambda job: job.created_monotonic_ns)
                oldest_ms = max(0.0, (time.monotonic_ns() - oldest_job.created_monotonic_ns) / 1e6)
            avg_ms = (
                self._queue_delay_total_ms / self._queue_delay_samples
                if self._queue_delay_samples
                else 0.0
            )
            return SchedulerMetrics(
                finals_submitted=self._finals_submitted,
                provisionals_submitted=self._provisionals_submitted,
                finals_completed=self._finals_completed,
                provisionals_completed=self._provisionals_completed,
                provisionals_coalesced=self._provisionals_coalesced,
                provisionals_dropped=self._provisionals_dropped,
                finals_dropped=self._finals_dropped,
                overload_events=self._overload_events,
                queue_depth=depth,
                oldest_queued_ms=oldest_ms,
                avg_queue_delay_ms=avg_ms,
                max_queue_delay_ms=self._queue_delay_max_ms,
            )

    def overload_events(self) -> int:
        with self._lock:
            return self._overload_events

    def _wake_all(self) -> None:
        self._lock.notify_all()

    def __len__(self) -> int:
        with self._lock:
            return len(self._heap)
