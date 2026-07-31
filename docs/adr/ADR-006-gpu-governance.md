# ADR-006: Gameplay-First GPU Resource Governance

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

The primary PC has an RTX 4070 Ti-class GPU, but captions must not create material frame-time
degradation.

## Decision

Default to batch size one, concurrency one, and bounded queues. ADR-012 supersedes the original
300M int8 model choice for the owner-selected Tagalog V1: Faster-Whisper large-v3 runs in CUDA FP16
and is expected to use roughly 4.5–6 GB VRAM. This is a planning range, not measured evidence.
Quality fallback is required if target-PC gameplay or latency gates fail.

## Consequences

The game receives resource priority and translation quality may be reduced under pressure. CUDA
OOM must become a recoverable user-visible error and the process must shut down cleanly. Automatic
mid-session model switching is deferred until both profiles are benchmarked.

## Alternatives Considered

Automatically selecting the largest model and unbounded GPU work queues were rejected.

## Evidence and Review Trigger

Record actual GPU model, VRAM, driver, latency, GPU use, VRAM, average FPS, 1% lows, and frame-time
tails on the target Windows PC in Phase 9.
