# Phase 5 Offline Clip Lab Validation Record

Date: 2026-07-30

Status: Media/VAD clip slice implemented on macOS with clearly labeled demo inference. Required
Silero, Omnilingual ASR, MADLAD translation, bilingual quality review, and Windows live-audio
evidence remain pending.

## Slice Acceptance Criteria

- Accept only a user-selected local MP4/video/audio path.
- Decode the first audio stream to 16 kHz mono without extracting audio to disk.
- Reject missing, unsupported, audio-less, oversized, or overlong files.
- Segment speech with pre-roll, minimum speech, hangover, maximum duration, and forced-split
  overlap.
- Bound clip output and sidecar IPC.
- Display clip-relative timestamps and make the active provider unambiguous.
- Persist no audio or transcript content.
- Refuse real inference while verified model artifacts are unavailable.
- Keep CI tests independent of large model downloads.

## Implemented Evidence

- FFmpeg and ffprobe are invoked with argument arrays, no shell, no stdin, and content-free errors.
- Media input is read-only and streamed from stdout as 16 kHz mono float32 chunks.
- File limits are 2 GiB and two hours; supported extensions are explicitly allowlisted.
- The utterance manager uses 30 ms frames, 180 ms pre-roll, 180 ms minimum speech, 450 ms hangover,
  and a 12-second maximum.
- Forced splits retain overlap for the following segment.
- A clip job returns at most 128 timestamped captions.
- The authenticated loopback sidecar validates `clip.process` with Pydantic.
- The desktop validates the response with Zod and shows only the selected basename.
- Demo transcript and translation strings explicitly say that local models are not installed.
- Selecting `local` mode returns `MODEL_MISSING`; it never falls back silently.
- No raw audio, extracted audio, transcript, or translation is written by the pipeline.

## Automated Evidence

- Python unit tests cover silence, speech gating, pre-roll, hangover, forced split, overlap, source
  mode rejection, and memory-only clip processing.
- A loopback integration test creates a temporary WAV, sends its absolute path through the
  authenticated sidecar, decodes it with FFmpeg, and receives one timestamped demo segment.
- Frontend tests validate timestamp formatting and reject an untruthful real-provider result.
- Rust types compile across the local protocol, supervisor, and Tauri command boundary.

## Deferred Model and Hardware Evidence

- [ ] Pinned Silero ONNX artifact and CPU provider.
- [ ] Pinned Omnilingual CTC 300M int8 model and tokens with SHA-256.
- [ ] Pinned MADLAD translation artifact and runtime with SHA-256.
- [ ] Real Filipino, Cebuano, Taglish, and Bislish consented clip results.
- [ ] WER/CER, translation rubric, critical-error, latency, CPU, RAM, GPU, and VRAM reports.
- [ ] Model corruption, missing-model, load-failure, and OOM recovery.
- [ ] Windows live endpoint path and previous phase hardware gates.

## Manual macOS Clip Check

1. Start the Tauri desktop app.
2. Drag one consented MP4, MOV, MKV, WAV, MP3, M4A, FLAC, OGG, AAC, or WebM onto the clip panel.
3. Select Filipino/Taglish, Cebuano/Bislish, or mixed mode.
4. Choose **Analyze clip**.
5. Confirm timestamps appear only for speech-like regions and every caption is labeled `Demo`.
6. Confirm no extracted audio or transcript file is created beside the clip.

## Current Gate

This record demonstrates clip plumbing, not translation accuracy. Do not claim that a real voice
clip has been transcribed or translated until verified model providers replace the demo providers.

