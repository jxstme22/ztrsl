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

Translation runs in-process inside the sidecar via CTranslate2 (NLLB-200-distilled-600M, int8, CUDA
when available, CPU fallback). The native Rust candle `translation-runner` (MADLAD-400-3B) remains
selectable as a CPU-only reference path but is no longer the default.

## Consequences

Packaging is larger and IPC increases attack surface. Tests retain fake providers and must never
download large models. Native migration requires measured latency, reliability, or packaging gains.

## Alternatives Considered

Immediate native ONNX integration was deferred because it slows the first measured vertical slice.
Cloud inference is rejected for V1.

## Evidence and Review Trigger

Review after baseline ASR/translation benchmarks and private-beta packaging tests.

