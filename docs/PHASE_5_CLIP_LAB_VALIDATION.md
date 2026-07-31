# Phase 5 Offline Clip Lab Validation Record

Date: 2026-07-30

Status: Media/VAD clip slice, verified contextual Whisper ASR, and quantized MADLAD translation
implemented on macOS. A consented noisy Tagalog DVR exposed and retired the Omnilingual CTC 300M
quality path. Required Cebuano evaluation, bilingual quality review, and Windows live-audio
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
- Demo transcript and translation strings explicitly say that they did not infer content.
- Local mode loads only artifacts that match the committed manifests and never falls back silently.
- No raw audio, extracted audio, transcript, or translation is written by the pipeline.
- Whisper large-v3-turbo preserves complete clip context, uses a Filipino decoder constraint, and
  runs through faster-whisper/CTranslate2 (int8 CPU on macOS, FP16 CUDA candidate on Windows).
- A dedicated Rust Candle worker loads the official-repository MADLAD Q4 GGUF once per sidecar and
  uses bounded JSON-lines requests. This avoids the 11.8 GB standard weight on the space-constrained
  Mac.
- MADLAD's T5 key/value cache is cleared before every independent sentence. Retaining the cache was
  proven to corrupt later translations into empty or repeated generic output.
- Empty translation output becomes an explicit low-confidence result, not a blank or confident
  caption.

## Automated Evidence

- Python unit tests cover silence, speech gating, pre-roll, hangover, forced split, overlap, source
  mode rejection, and memory-only clip processing.
- A loopback integration test creates a temporary WAV, sends its absolute path through the
  authenticated sidecar, decodes it with FFmpeg, and receives one timestamped demo segment.
- Frontend tests validate timestamp formatting and reject an untruthful real-provider result.
- Rust types compile across the local protocol, supervisor, and Tauri command boundary.
- The clean ASR archive SHA-256 is
  `cdcd0559c7c73efed54209a926e321afc914d046c5fdbf3665f00dc78180e5ed`.
- Extracted ASR model/token and MADLAD config/GGUF/tokenizer hashes are committed under
  `models/manifests/`.
- The official sherpa English WAV produced the expected 77-character transcript. Observed model
  inference on this Mac: ASR 275.4 ms for 3.87 seconds of speech; Q4 translation 1,431.1 ms for the
  Tagalog text fixture. These are development observations, not the reference-PC benchmark.
- The text fixture `Punta tayo sa B, nasa A na sila.` translated to
  `Let's go to B, they are in A.`. The Cebuano text fixture returned empty and is correctly surfaced
  as low confidence; Cebuano quality is therefore an open risk, not accepted.
- `pnpm test`: 25 frontend tests passed across eight files.
- `pytest`: 15 Python tests passed, including three loopback/FFmpeg sidecar tests.
- `cargo test --workspace`: 27 standard Rust tests passed; all three explicitly ignored process/model
  integration tests were also run and passed.
- Ruff, strict mypy, ESLint, strict TypeScript, rustfmt, and Clippy with warnings denied passed.
- Frontend and optimized Rust workspace builds passed. The resulting Mac binaries are
  `target/release/local-squad-desktop` and `target/release/translation-runner`.
- Windows MSVC cross-check still passes for audio, IPC, and supervisor code. Cross-checking Candle's
  tokenizer from macOS is blocked by the absence of Windows C/C++ SDK headers; it must be compiled
  natively on the Windows PC.

## Deferred Model and Hardware Evidence

- [ ] Pinned Silero ONNX artifact and CPU provider.
- [x] Pinned Whisper large-v3-turbo CTranslate2 artifacts with SHA-256.
- [x] Retained Omnilingual CTC 300M int8 only as a research baseline.
- [x] Pinned MADLAD Q4 translation artifact and runtime with SHA-256.
- [ ] Real Filipino, Cebuano, Taglish, and Bislish consented clip results.
- [ ] WER/CER, translation rubric, critical-error, latency, CPU, RAM, GPU, and VRAM reports.
- [ ] Model corruption, missing-model, load-failure, and OOM recovery.
- [ ] User cancellation for a long-running clip job; closing the app remains the current hard stop.
- [ ] Windows live endpoint path and previous phase hardware gates.

## Manual macOS Clip Check

1. Start the Tauri desktop app.
2. Drag one consented MP4, MOV, MKV, WAV, MP3, M4A, FLAC, OGG, AAC, or WebM onto the clip panel.
3. Select Filipino/Taglish, Cebuano/Bislish, or mixed mode.
4. Choose **Analyze clip**.
5. Start with Demo, then choose Local models and confirm its result is labeled `Local`.
6. Confirm no extracted audio or transcript file is created beside the clip.

## Current Gate

This record demonstrates working local providers and clip plumbing, not Tagalog/Cebuano accuracy.
Do not claim language quality until consented voice fixtures receive transcript labels and bilingual
review.
