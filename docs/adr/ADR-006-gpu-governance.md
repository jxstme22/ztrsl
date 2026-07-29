# ADR-006: Gameplay-First GPU Resource Governance

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

The primary PC has an RTX 4070 Ti-class GPU, but captions must not create material frame-time
degradation.

## Decision

Default to the 300M int8 ASR baseline, batch size one, concurrency one, bounded queues, and a
balanced profile targeting less than 5 GB VRAM. Low, balanced, and quality profiles are explicit.
The 1B ASR and higher-precision translation remain benchmark-gated.

## Consequences

The game receives resource priority and translation quality may be reduced under pressure. CUDA
OOM must recover to a lower profile without crashing.

## Alternatives Considered

Automatically selecting the largest model and unbounded GPU work queues were rejected.

## Evidence and Review Trigger

Record actual GPU model, VRAM, driver, latency, GPU use, VRAM, average FPS, 1% lows, and frame-time
tails on the target Windows PC in Phase 9.

