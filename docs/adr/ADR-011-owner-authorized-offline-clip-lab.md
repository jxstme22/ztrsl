# ADR-011: Owner-Authorized Offline Clip Lab Before Windows Audio Acceptance

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainer

## Context

ADR-010 deferred model-backed Phase 5 work until the Windows audio path could be accepted. The
development host remains macOS, and the owner has now explicitly asked to continue until the app can
be exercised with user-selected MP4/video clips containing consented friends' Tagalog or Cebuano
comms.

The clip workflow does not depend on a Windows endpoint and can validate media decoding, bounded
segmentation, sidecar IPC, model readiness, and timestamped subtitle presentation without touching
VALORANT or capturing any live voice.

## Decision

Add an offline clip lab as a separate, owner-authorized vertical slice:

- accept only an explicit user drag-and-drop path;
- read the selected media file without modifying it;
- validate type, audio presence, size, and duration;
- stream 16 kHz mono float PCM from FFmpeg stdout without creating an extracted-audio file;
- keep utterance buffers bounded and cap a job at 128 segments;
- retain no audio or transcript history by default;
- make demo and real model modes visibly distinct;
- reject real inference while verified local artifacts are missing;
- keep all large model installation explicit, pinned, checksummed, licensed, and local-only.

The deterministic energy-based speech detector is a development fallback for fixtures. It does not
replace the required Silero ONNX provider or satisfy final Phase 5 quality acceptance.

## Consequences

The maintainer can validate the complete clip plumbing on macOS before moving to Windows. The
current build can detect and timestamp speech-like regions in real MP4/audio files, but it cannot
yet truthfully transcribe or translate their contents until the pinned ASR and MT runtimes and
artifacts are installed.

No clip test counts as Windows WASAPI, overlay-focus, or game validation. No voice clip is suitable
for repository fixtures unless every speaker has consented to that retention.

## Alternatives Considered

Waiting for Windows would leave platform-neutral model and media integration idle. Uploading clips
to a cloud transcription API was rejected because V1 is local-only. Silently downloading models on
first analysis was rejected because it violates the model supply-chain and normal-inference rules.

## Review Trigger

Review when verified Omnilingual ASR, Silero VAD, and MADLAD artifacts are pinned, and again when the
repository moves to Windows. Windows Phase 1–3 acceptance remains required before live voice
capture is connected to these providers.

