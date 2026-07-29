# Build Plan

## General Rule

Complete phases sequentially. A phase may begin only after the previous phase's automated and manual acceptance checks pass.

## Phase 0 — Repository and Toolchain

### Deliverables

- workspace skeleton;
- pinned Node package manager;
- Rust workspace;
- Python environment;
- lint/typecheck/test commands;
- CI for non-hardware tests;
- ADR template;
- basic docs.

### Acceptance

- clean clone can run lightweight checks;
- no models required for CI;
- no secrets;
- all workspaces have version files/lockfiles.

## Phase 1 — External Overlay Prototype

### Deliverables

- Tauri control window;
- separate overlay window;
- transparent/topmost behavior;
- click-through play mode;
- edit mode;
- fake caption generator;
- configurable hotkeys;
- multi-monitor position storage.

### Tests

- caption reducer;
- stale revision rejection;
- expiration;
- position normalization;
- focus test.

### Manual Acceptance

- overlay visible over Notepad and a borderless test game/window;
- game/test window retains focus during caption updates;
- click-through works;
- edit mode works;
- overlay can be recovered if off-screen.

## Phase 2 — Windows Audio Enumeration and Meter

### Deliverables

- list capture/render endpoints;
- detect device changes;
- select and persist endpoint IDs;
- capture meter only;
- no playback yet;
- synthetic audio source for tests.

### Acceptance

- selected virtual cable shows level;
- disconnect does not crash;
- replug recovery works;
- callback has no logging or blocking.

## Phase 3 — Monitoring and Routing

### Deliverables

- captured audio forwarded to physical output;
- monitor volume;
- resampling branch for inference;
- feedback validation;
- underrun/overflow metrics;
- routing test UI.

### Acceptance

- voice is audible;
- no obvious echo;
- game audio remains on physical headphones;
- monitoring continues with inference disabled;
- two-hour audio soak has bounded memory.

## Phase 4 — IPC and Fake Inference

### Deliverables

- authenticated localhost protocol;
- sidecar supervisor;
- fake VAD/ASR/MT service;
- health and restart behavior;
- binary audio messages;
- protocol tests.

### Acceptance

- fake audio produces fake captions end to end;
- invalid token rejected;
- stale messages rejected;
- sidecar crash creates a recoverable UI state;
- desktop shutdown terminates sidecar.

## Phase 5 — VAD

### Deliverables

- Silero ONNX integration;
- utterance manager;
- pre-roll/hangover/max duration;
- debug waveform/segments outside overlay;
- deterministic fixture tests.

### Acceptance

- speech fixtures segmented correctly within tolerance;
- silence does not create utterances;
- game-like non-speech false positives measured;
- no raw audio written by default.

## Phase 6 — Omnilingual ASR Baseline

### Deliverables

- 300M int8 adapter;
- model manifest and downloader;
- explicit source mode;
- final utterance transcription;
- ASR benchmark command;
- fake provider retained for tests.

### Acceptance

- Tagalog and Cebuano fixtures transcribe;
- model checksum enforced;
- missing/corrupt model UX works;
- ASR timing and memory reported;
- CPU fallback behavior documented.

## Phase 7 — Translation Baseline

### Deliverables

- MADLAD adapter;
- English target generation;
- protected terms;
- English-skip logic;
- final subtitles;
- translation benchmark command.

### Acceptance

- representative fixtures translated;
- glossary terms preserved;
- already-English callouts avoid destructive translation;
- OOM is recoverable;
- no model downloads occur inside normal inference execution.

## Phase 8 — Provisional Captions and Stabilization

### Deliverables

- rolling ASR decode;
- stable-prefix tracking;
- job coalescing;
- provisional translation;
- provisional/final overlay styling;
- full stage latency tracing.

### Acceptance

- revision rate measured;
- final caption does not endlessly mutate;
- stale provisional jobs are canceled/coalesced;
- queues remain bounded in fast speech.

## Phase 9 — Resource Governance

### Deliverables

- low/balanced/quality profiles;
- GPU/VRAM metrics;
- inference scheduling controls;
- game-running mode;
- optional 1B ASR benchmark;
- automatic fallback on OOM.

### Acceptance

- default profile remains inside VRAM target on reference PC;
- no unbounded GPU queue;
- VALORANT frame-time comparison documented;
- 1B is enabled only if benchmark gate passes.

## Phase 10 — Real VALORANT Validation

### Preconditions

- strict external-only design reviewed;
- no forbidden interaction;
- Borderless Windowed mode;
- personal testing environment.

### Test Matrix

- party voice;
- team voice where permitted;
- Tagalog;
- Cebuano;
- mixed English;
- no speech;
- gunfight;
- menu;
- agent select;
- match transition;
- game restart;
- overlay toggle;
- device reconnect.

### Acceptance

- voice isolation confirmed;
- overlay does not steal input;
- no process injection or memory access;
- gameplay resource impact recorded;
- limitations documented.

## Phase 11 — Model Evaluation

### Deliverables

- consented labeled corpus;
- WER/CER evaluator;
- glossary accuracy;
- human translation rubric;
- critical-error categorization;
- comparison of 300M vs 1B and quantization profiles.

### Gate

Choose models from data, not intuition.

## Phase 12 — Packaging

### Deliverables

- signed or test-signed installer;
- sidecar packaging;
- model setup wizard;
- uninstall;
- clean model removal option;
- first-run audio setup;
- crash-safe shutdown;
- release notes.

### Acceptance

- clean Windows VM install;
- no developer tools required;
- model checksum flow works;
- uninstall leaves only user-approved data;
- driver is not silently bundled.

## Phase 13 — Public-Release Readiness

Only after:

- product policy review/registration;
- legal/license review;
- privacy policy;
- user consent wording;
- code signing;
- update security;
- support plan;
- public benchmark summary;
- accessibility review.

## Suggested Milestone Names

```text
M0 Skeleton
M1 Overlay
M2 Audio
M3 Local Pipeline
M4 Live Captions
M5 Game Validation
M6 Installer
M7 Public Readiness
```

## Rollback Principle

Every high-risk feature must be behind a feature flag:

- provisional decoding;
- 1B ASR;
- GPU translation;
- process loopback experiment;
- history;
- diagnostics recording.

The last known stable model/profile remains selectable.
