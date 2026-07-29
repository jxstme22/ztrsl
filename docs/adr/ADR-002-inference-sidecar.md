# ADR-002: Python Sidecar Before Native Inference

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Model experimentation and GPU debugging must progress without blocking the Tauri UI or hard-wiring
one inference runtime into the desktop process.

## Decision

Start with a local Python 3.11+ sidecar behind typed provider interfaces. IPC will bind to loopback,
authenticate with a random per-launch token, enforce limits, and shut down deterministically.

## Consequences

Packaging is larger and IPC increases attack surface. Tests retain fake providers and must never
download large models. Native migration requires measured latency, reliability, or packaging gains.

## Alternatives Considered

Immediate native ONNX integration was deferred because it slows the first measured vertical slice.
Cloud inference is rejected for V1.

## Evidence and Review Trigger

Review after baseline ASR/translation benchmarks and private-beta packaging tests.

