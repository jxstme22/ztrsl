# Phase 6 — Shared Bounded Inference Scheduler

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 6)

1. ASR and translation share one bounded queue set; model VRAM is shared, never duplicated per source.
2. Source priorities: final captions > provisional updates; all-sources-fair ordering when idle.
3. Stale provisional jobs are coalesced/dropped; final jobs are never dropped.
4. Overload is handled explicitly (backpressure, metrics, visible diagnostic).

## Tasks
- [ ] `services/inference/.../scheduler/` bounded queues with priorities per spec §7.4
- [ ] Provisional coalescing (latest-wins per source), final-job preservation
- [ ] Overload policy + counters
- [ ] Scheduler metrics endpoint for Phase 10
- [ ] Unit tests: priority inversion, coalescing, drop behavior under load
- [ ] Latency evidence: one concurrent speech keeps normal latency (Phase 11 table reference)

## Files (expected)
- `services/inference/src/local_squad_inference/scheduler/*`
- `services/inference/src/local_squad_inference/profiles/`

## Evidence policy
Load test: N sources → bounded queue depth, no unbounded growth, finals never dropped; metrics logged in phase log.
