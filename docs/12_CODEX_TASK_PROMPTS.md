# Codex Task Prompts

Use one prompt at a time. Codex must read `AGENTS.md` and the referenced specification before editing.

## Prompt 0 — Bootstrap

```text
Read AGENTS.md, README.md, docs/01_PRD.md, docs/02_SYSTEM_ARCHITECTURE.md, and docs/07_BUILD_PLAN.md.

Create the Phase 0 monorepo skeleton for Windows 11:
- Tauri 2 desktop app with React and strict TypeScript;
- Rust workspace crates for audio-core, overlay-core, ipc-protocol, and diagnostics;
- Python 3.11 inference service with Ruff, type checking, and pytest;
- pnpm workspace;
- CI for all tests that do not require Windows audio hardware or large models;
- ADR template and first ADR placeholders.

Do not implement game integration, inference, or audio capture yet.
Do not download models.
Run formatting, lint, type checks, and tests.
Report changed files, commands run, and any deviations.
```

## Prompt 1 — Overlay

```text
Read AGENTS.md, docs/05_OVERLAY_AND_DESKTOP_APP.md, and Phase 1 of docs/07_BUILD_PLAN.md.

Implement the external caption overlay vertical slice:
- separate Tauri overlay window;
- transparent and topmost;
- click-through play mode;
- interactive edit mode;
- no focus stealing;
- fake caption generator;
- provisional/final states;
- configurable global hotkeys;
- normalized multi-monitor position persistence;
- off-screen recovery.

Add unit and end-to-end tests where feasible.
Keep Windows-specific unsafe code isolated and documented.
Do not hook or inspect any game.
Run all relevant checks and provide manual validation steps.
```

## Prompt 2 — Audio Enumeration

```text
Read AGENTS.md, docs/03_WINDOWS_AUDIO_ROUTING.md, docs/06_DATA_MODELS_AND_PROTOCOLS.md, and Phase 2 of docs/07_BUILD_PLAN.md.

Implement Windows audio endpoint enumeration and capture metering:
- stable endpoint IDs;
- capture/render distinction;
- default-role markers;
- device notifications;
- selected endpoint persistence;
- bounded audio frame path;
- level meter;
- synthetic AudioSource for tests.

No playback forwarding yet.
No work that blocks in audio callbacks.
Add device invalidation handling and tests.
```

## Prompt 3 — Monitoring

```text
Read AGENTS.md and docs/03_WINDOWS_AUDIO_ROUTING.md.

Implement Phase 3:
- capture selected virtual cable endpoint;
- forward native-format audio to selected physical headphones;
- branch a copy for 16 kHz mono inference;
- streaming resampling;
- bounded ring buffers;
- volume control and ramp;
- underrun/overflow metrics;
- obvious feedback-loop configuration prevention;
- routing test UI.

Audio monitoring has priority over inference.
Add unit tests for downmix, resampling bookkeeping, buffers, and validation.
Document manual tests for USB and Bluetooth endpoints.
```

## Prompt 4 — IPC and Fake Sidecar

```text
Read AGENTS.md, docs/02_SYSTEM_ARCHITECTURE.md, and docs/06_DATA_MODELS_AND_PROTOCOLS.md.

Implement the authenticated localhost IPC and sidecar supervisor:
- loopback-only ephemeral port;
- random per-launch token;
- versioned handshake;
- binary audio frames;
- message size limits;
- strict runtime validation;
- health events;
- controlled shutdown and restart;
- fake VAD/ASR/translation modes;
- full fake audio-to-overlay vertical slice.

Add protocol fuzz/property tests where appropriate.
Ensure invalid clients cannot submit audio.
```

## Prompt 5 — VAD

```text
Read AGENTS.md, docs/04_ASR_TRANSLATION_PIPELINE.md, and Phase 5 of docs/07_BUILD_PLAN.md.

Integrate Silero VAD ONNX in the local sidecar:
- 16 kHz mono frames;
- configurable threshold;
- pre-roll;
- minimum speech;
- hangover silence;
- max utterance duration;
- forced splits;
- monotonic timestamps;
- deterministic fixture tests.

Do not persist audio.
Expose VAD state and segmentation diagnostics.
Keep a fake provider for CI.
```

## Prompt 6 — ASR

```text
Read AGENTS.md, docs/04_ASR_TRANSLATION_PIPELINE.md, docs/08_TEST_AND_BENCHMARK_PLAN.md, and Phase 6 of docs/07_BUILD_PLAN.md.

Implement an AsrProvider adapter for Omnilingual ASR CTC 300M int8 using the pinned sherpa-onnx-compatible model:
- explicit Filipino, Cebuano, mixed modes;
- model manifest and SHA-256 verification;
- local-files-only operation;
- no remote code;
- model warmup;
- final utterance transcription;
- timing and memory metrics;
- recoverable missing/corrupt/OOM errors;
- benchmark CLI.

Do not enable 1B by default.
Tests must use a fake provider unless explicitly tagged model/hardware.
```

## Prompt 7 — Translation

```text
Read AGENTS.md and docs/04_ASR_TRANSLATION_PIPELINE.md.

Implement the translation provider using the pinned MADLAD-400 3B MT checkpoint:
- English target generation;
- local-only model load;
- safe artifact formats;
- glossary/protected-term masking and restoration;
- already-English skip logic;
- timing and memory metrics;
- OOM recovery;
- benchmark CLI;
- fake provider for CI.

Pin the compatible Transformers/runtime version and document the reason.
Do not assume community quantized weights are trusted; use a verified artifact workflow.
```

## Prompt 8 — Live Stabilization

```text
Read docs/04_ASR_TRANSLATION_PIPELINE.md and Phase 8 of docs/07_BUILD_PLAN.md.

Implement:
- scheduled provisional ASR decodes;
- stable-prefix calculation;
- stale job cancellation/coalescing;
- phrase-boundary translation;
- provisional/final caption lifecycle;
- full stage timestamps;
- queue depth metrics;
- bounded backpressure.

Add deterministic tests using sequences of fake ASR hypotheses.
Ensure final captions become terminal and do not oscillate.
```

## Prompt 9 — Benchmark and Profiles

```text
Read docs/08_TEST_AND_BENCHMARK_PLAN.md.

Implement:
- low/balanced/quality configuration profiles;
- JSON and Markdown benchmark reports;
- git commit, model checksum, hardware/config capture;
- ASR, MT, and end-to-end benchmark commands;
- critical tactical error labels;
- resource and latency summaries;
- optional 1B ASR experiment behind a feature flag.

Do not select the 1B model automatically.
Produce a comparison report from available consented fixtures.
```

## Prompt 10 — Installer

```text
Read AGENTS.md, docs/09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md, and docs/10_RELEASE_INSTALLER_OPERATIONS.md.

Build the private-beta Windows packaging flow:
- app and sidecar installer;
- no bundled virtual audio driver;
- model manager with HTTPS download, checksums, atomic install, repair, and removal;
- clean uninstall options;
- content-free support bundle;
- no telemetry;
- clean-machine installation script/checklist.

Do not claim public-release readiness.
Document code-signing placeholders and required legal/policy work.
```

## Prompt 11 — Final Audit

```text
Audit the repository against every item in docs/15_ACCEPTANCE_CHECKLIST.md.

For each item:
- mark pass, fail, or not tested;
- cite evidence: file, test, log, benchmark, or manual result;
- do not infer a pass from compilation;
- create issues/tasks for every failure;
- confirm no forbidden game interaction exists.

Produce docs/FINAL_AUDIT.md and do not modify behavior unless required to make the audit tooling run.
```
