# v0.4 Phase 7 — Adaptive Scheduler

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 7)

1. Resource policies — ☑ `ResourcePolicy` (maximum_accuracy / balanced /
   protect_game_performance) on `InferenceScheduler`.
2. Provisional throttling — ☑ balanced throttles secondary-source provisionals
   while any final is queued; protect_game_performance keeps only the primary
   (highest-priority queued) source's provisionals.
3. TEAM priority — ☑ via per-source `priority` (TEAM=200 default in fixtures);
   primary is the highest-priority queued source.
4. Overload behavior — ☑ finals never dropped silently; provisionals are
   dropped/refused under load (existing §7.3 semantics preserved).

**Acceptance:** final jobs survive and queues stay bounded. — ☑
`test_scheduler.py` resource-policy tests + existing priority/overload tests.

## Implementation

`services/inference/src/local_squad_inference/scheduler.py`:

- `ResourcePolicy` literal + `DEFAULT_RESOURCE_POLICY = "balanced"`.
- `InferenceScheduler(resource_policy=...)` + `set_resource_policy()` (hot,
  no restart).
- `_submit_provisional` consults `_throttled()`: maximum_accuracy never
  throttles; balanced holds secondary provisionals while a final is queued;
  protect_game_performance preserves only the primary source's provisionals.
  Throttling counts as `provisionals_dropped` but NOT an overload event
  (deliberate policy, not queue pressure).

Tests: `test_scheduler.py` (+5) — maximum_accuracy passes, balanced throttles,
protect keeps primary only, runtime policy switch; the pre-existing
high-water/overload test now pins `maximum_accuracy` to preserve its intent.

## Follow-ups

- Wire `set_resource_policy` from the desktop resource-policy control and the
  live worker's pressure state.
