# ADR-017: Shared Bounded Inference Scheduler

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

v0.2 loaded one model set and processed one utterance stream. With multiple
sources, naively giving each source its own model copy multiplies VRAM and
GPU residency beyond the device budget (ADR-006 GPU governance). Naive
queueing also lets one loud source starve others and drops finals.

## Decision

- All sources share ONE model set in the sidecar. ASR and translation each
  have a single bounded queue (cap on outstanding jobs; explicit backpressure,
  no unbounded growth — AGENTS.md engineering rules).
- Scheduler priorities (spec §7.4): final caption jobs > provisional updates;
  all sources treated fairly (round-robin) when idle; per-source job caps so no
  source monopolizes.
- Provisional jobs are coalesced: only the newest provisional utterance per
  source stays queued (stale ones are dropped/merged, counted as metrics).
- Final jobs are never dropped; if queues are full, provisional jobs are
  dropped first and the fact is surfaced in scheduler metrics + diagnostics.
- Load shedding is visible: metrics include queue depth, drops, coalescing
  rate, and per-job latency for Phase 10.

## Consequences

- VRAM stays bounded regardless of source count.
- Under load, provisional freshness degrades first, finals survive.
- Deterministic behavior testable with a load harness (no unbounded queues).

## Alternatives Considered

- Per-source model copies: rejected — VRAM multiplication violates ADR-006.
- Unbounded queues with lossy tail: rejected — unbounded growth violates
  engineering rules.

## Evidence and Review Trigger

- Phase 6 load test: N sources → bounded queue depth, finals never dropped,
  coalescing counters correct.
- Phase 11: one concurrent speech instance keeps normal latency.
- Release criteria item: shared-VRAM requirement verified on device.
