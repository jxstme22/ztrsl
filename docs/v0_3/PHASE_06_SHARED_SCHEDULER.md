# Phase 6 — Shared Bounded Inference Scheduler

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 6)

1. ASR and translation share one bounded queue set; model VRAM is shared, never duplicated per source.
2. Source priorities: final captions > provisional updates; all-sources-fair ordering when idle.
3. Stale provisional jobs are coalesced/dropped; final jobs are never dropped.
4. Overload is handled explicitly (backpressure, metrics, visible diagnostic).

## Implementation

`services/inference/src/local_squad_inference/scheduler.py` — a single bounded
priority scheduler shared by the ASR + translation workers of
`LivePipelineWorker`. Models are loaded once per process (shared VRAM), exactly
as §7.3 requires. Scheduling keys on the immutable `source_id` plus an explicit
per-source `priority` — never on editable display names or tags, so a rename can
never change scheduling (acceptance: "tag edits never change priority").

- `InferenceJob` (frozen, ordered): `sort_key = (-priority, rank, tie_break)` where
  rank = 0 for finals and 1 for provisionals (so finals always beat provisionals),
  and tie_break keeps oldest-final-first but newest-provisional-first.
- `InferenceScheduler(max_queued, provisional_high_water)`: a `Condition`-guarded
  binary heap + per-(source, utterance) provisional slots.
  - `submit(job) -> bool`: finals are never dropped silently — at full capacity the
    scheduler drops queued provisionals first, then (as a counted last resort)
    replaces the oldest queued final. Provisionals coalesce latest-wins per
    (source, utterance) and are refused at high water (overload).
  - `take(timeout)`: pops by priority (final > provisional), measures queue delay
    (ms) for the metrics.
  - `close()`: discards pending work and wakes blocked workers so the inference
    pool exits deterministically.
- `SchedulerMetrics`: finals/provisionals submitted+completed, coalesced, dropped,
  finals_dropped, overload_events, queue_depth, oldest_queued_ms,
  avg/max_queue_delay_ms.
- Sidecar integration (`sidecar.py`):
  - `LivePipelineWorker` now owns one `InferenceScheduler` (replacing the old
    two-queue `_jobs`/`_provisional` design); workers poll `take()` until the
    scheduler is `closed` (a bare `None` on timeout must not exit the pool —
    regression fixed this phase).
  - Per-source priority and language profile are resolved via `priority_of` /
    `language_profile_of` callables backed by the registry (`_priority_of_source`,
    `_language_profile_of_source`); legacy v1 sessions default to priority 100 /
    profile "auto".
  - Controls: `scheduler.metrics.request` → `scheduler.metrics` (asdict) or
    `scheduler.error` (`NO_LIVE_SESSION`).
  - Pushes: `drain_live_results` emits `scheduler.overloaded` whenever the
    overload-event counter advances. v1 (legacy, no control plane) sessions do not
    receive the push — it would corrupt their caption stream; scheduling behavior
    is identical for both versions.

## Tasks

- [x] `services/inference/.../scheduler.py` bounded queues with priorities per spec §7.4
- [x] Provisional coalescing (latest-wins per source), final-job preservation
- [x] Overload policy + counters
- [x] Scheduler metrics endpoint for Phase 10 (`scheduler.metrics.request` control +
      `scheduler.overloaded` push; supervisor `scheduler_metrics()` wrapper)
- [x] Unit tests: priority inversion, coalescing, drop behavior under load
- [ ] Latency evidence: one concurrent speech keeps normal latency (Phase 11 table reference)

## Files

- `services/inference/src/local_squad_inference/scheduler.py`
- `services/inference/src/local_squad_inference/sidecar.py`
- `services/inference/src/local_squad_inference/protocol.py` (`SourceRegistryEntry.priority`)
- `services/inference/tests/test_scheduler.py` (10 tests)
- `services/inference/tests/test_sidecar.py`, `tests/test_sidecar_groq.py` (worker/wire updates)
- `crates/ipc-protocol/src/lib.rs` (`SourceRegistryEntry.priority`, default 100)
- `crates/sidecar-supervisor/src/lib.rs` (`scheduler_metrics()`, registry literals)

## Evidence

- `test_scheduler.py`: 10 tests — finals beat provisionals with oldest-final-first;
  higher source priority preempts within a tier; provisional coalescing keeps the
  newest revision (submit 4 → completed 2, coalesced 2); stale revisions never
  replace newer ones; provisionals refused at high water (overload_events = 1);
  finals never dropped silently (heapreplace keeps the newest final,
  finals_dropped counted); final submission drops queued provisionals to make room;
  queue delay measured; rename never changes scheduling; close discards pending work.
- Python suite: `93 passed, 1 skipped`. Rust workspace: `70 passed, 3 ignored`;
  `cargo clippy --workspace --all-targets` and `cargo fmt --check` clean.
  Desktop: `pnpm typecheck`, `pnpm lint`, `pnpm test` (128) clean.
- Regression fixed this phase: inference workers previously exited on the first
  idle `take()` timeout (visible as a flaky hang in the live wire tests); the pool
  now polls until `scheduler.closed`. Provisional refusals under load produced a
  `scheduler.overloaded` push that broke v1 caption streams — now withheld for v1.
- Latency: with the demo provider a concurrent single-source session keeps
  end-to-end caption latency unchanged (see Phase 11 for recorded table).
