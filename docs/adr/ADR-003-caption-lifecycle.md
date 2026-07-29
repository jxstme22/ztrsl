# ADR-003: Provisional and Final Caption Lifecycle

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Fast word-by-word translation is unstable, while waiting for full utterances creates excessive
delay.

## Decision

Captions use stable IDs and monotonic revisions. Provisional captions may change and are visually
distinct. Final captions are terminal after their correction window. The desktop rejects stale
revisions.

## Consequences

The pipeline needs stable-prefix tracking, stale-job coalescing, and deterministic reducer tests.
The UI must clearly communicate uncertainty.

## Alternatives Considered

Final-only captions were too slow; unrestricted mutable captions were too disruptive.

## Evidence and Review Trigger

Review using Phase 8 revision-rate, stable-prefix, latency, and reading-usability results.

