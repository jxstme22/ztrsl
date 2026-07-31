# ADR-012: Tagalog-First Whisper large-v3 V1

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainer

## Context

The original plan proposed Omnilingual CTC 300M as the default for Tagalog and Cebuano. A
consented noisy VALORANT DVR clip produced severe unrelated-script drift and unreliable tactical
phrases with that checkpoint. Forced-Filipino Faster-Whisper large-v3-turbo preserved substantially
more Latin-script Tagalog. The owner selected maximum Tagalog quality for V1 on a Windows 11 PC
with an RTX 4070 Ti and accepted higher VRAM use.

## Decision

V1 live mode is Filipino/Tagalog and Taglish only. It uses:

- stateful Silero VAD on CPU;
- Faster-Whisper `large-v3`, forced language `tl`, CUDA FP16, beam size 5, batch/concurrency one;
- conservative normalization and unrelated-script rejection;
- the pinned MADLAD-400 3B Q4 worker for English translation;
- final captions after a 416 ms conversation pause, with bounded 18-second utterances;
- bounded audio, inference, and UI queues with deterministic shutdown.

The energy VAD remains only as a deterministic test and macOS simulator fallback. Cebuano/Bislish
is not advertised as reliable in V1 and remains a benchmark candidate.

## Consequences

Tagalog accuracy is prioritized over the former small-model resource target. The reference
configuration is expected to consume roughly 4.5–6 GB of VRAM for ASR, but this estimate is not a
hardware result. Target-PC latency, peak VRAM, gameplay frame times, noisy-speech accuracy, and
critical tactical errors must be recorded before release. Low-confidence text remains visibly
uncertain instead of being silently “corrected.”

## Alternatives Considered

- Omnilingual CTC 300M int8: rejected as the V1 default after unrelated-script drift on the owner’s
  noisy clip.
- `large-v3-turbo`: retained as an emergency/fallback artifact, but not the quality default.
- Overlapping-speaker separation: deferred; a single mixed voice-chat endpoint cannot reliably
  recover simultaneous speakers without a separately validated diarization/separation stage.

## Evidence and Review Trigger

Review after the owner runs the pinned benchmark set on the RTX 4070 Ti. Revisit the model or
compute type if p95 final-caption latency, VRAM, or gameplay frame-time gates fail.
