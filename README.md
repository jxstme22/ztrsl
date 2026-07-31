# Local Live Translator Overlay for VALORANT

A working foundation for a **fully local Windows desktop companion** that:

- listens to incoming party/team voice routed from VALORANT;
- recognizes **Tagalog/Filipino and Taglish** in V1;
- translates non-English speech into English;
- displays low-latency subtitles in a transparent, click-through overlay;
- does not inject into, read memory from, automate, or modify VALORANT;
- keeps raw audio and transcripts local by default.

> Research and planning snapshot: **2026-07-29**  
> Primary target hardware: **Windows 11 + NVIDIA RTX 4070 Ti (12 GB assumed)**  
> Initial application type: **private alpha**, followed by public distribution only after Windows
> hardware validation, policy review, model-license review, and signing.

## Current Implementation

The macOS-buildable foundation, offline clip lab, and live translation vertical slice are
implemented:

- Tauri 2 desktop control-window foundation with React and strict TypeScript;
- Rust workspace crates for audio boundaries, caption state, IPC protocol, and content-free diagnostics;
- Python 3.11+ inference-sidecar skeleton with strict Pydantic payloads;
- bounded queue and failure-path unit tests;
- CI for frontend, Python, and Windows Rust checks;
- all required architecture decisions plus the macOS-first sequencing record;
- separate transparent/topmost Tauri caption overlay;
- click-through play mode and interactive edit mode;
- preview provisional-to-final caption lifecycle;
- configurable global hotkeys;
- normalized monitor placement, persistence, and missing-monitor recovery.
- typed Windows endpoint catalog and device-notification implementation;
- explicit, locally persisted capture-endpoint selection;
- capture-only level meter UI with a deterministic synthetic source on macOS;
- bounded audio queues and lock-free level handoff.
- bounded monitoring and 16 kHz mono inference routing branches;
- streaming 44.1/48/96 kHz resampling and content-free routing metrics;
- loopback-only authenticated WebSocket IPC with bounded binary audio frames;
- supervised Python fake inference with provisional/final captions and restart handling.
- user-approved MP4/video/audio drag-and-drop with read-only FFmpeg streaming;
- bounded speech segmentation and timestamped clip results;
- pinned Faster-Whisper large-v3 Tagalog ASR with a verified turbo development fallback;
- CPU Silero VAD and bounded live utterance segmentation;
- continuous Windows capture-to-sidecar-to-overlay live caption plumbing;
- a persistent Rust Candle worker for the verified MADLAD-400 3B Q4 translation model;
- explicit atomic model installers and committed SHA-256 manifests.

No audio or transcript is retained. macOS uses a clearly labeled generated-signal simulator;
ordinary Windows endpoint capture activates only in the Windows build. Windows overlay, audio,
CUDA, latency, VRAM, and gameplay acceptance remain unverified until the reference PC is available.
The current sidecar still uses the project Python environment and separately built translation
worker, not packaged public-release resources.

## Read This First

1. Read `AGENTS.md`.
2. Read `docs/00_EXECUTIVE_SUMMARY.md`.
3. Treat `docs/01_PRD.md` and `docs/15_ACCEPTANCE_CHECKLIST.md` as the source of truth.
4. Implement phases in `docs/07_BUILD_PLAN.md` in order.
5. Do not start GPU optimization until the CPU/audio/overlay skeleton passes its tests.
6. Do not add game hooks, DLL injection, memory reading, input automation, or a kernel component.

## Recommended V1 Stack

| Area | Choice |
|---|---|
| Desktop shell | Tauri 2 |
| Native layer | Rust |
| Overlay UI | React + TypeScript |
| Windows audio | WASAPI via `windows-rs` or a carefully selected safe wrapper |
| Routing | User-installed signed virtual audio cable for V1 |
| VAD | Silero VAD ONNX |
| Live ASR | Faster-Whisper large-v3, forced Filipino, CUDA FP16 |
| VAD | Silero VAD v6 ONNX on CPU |
| Fallback | large-v3-turbo after an explicit benchmark or resource failure |
| Translation | MADLAD-400 3B MT, quantized where validated |
| Initial inference process | Python local sidecar |
| Final optimized runtime | ONNX/sherpa-onnx native integration where practical |
| IPC | localhost WebSocket with random per-launch token |
| Packaging | Windows installer; models downloaded separately with checksums |

## Product Principle

The application uses a **two-speed subtitle strategy**:

1. **Provisional caption:** fast, allowed to revise.
2. **Final caption:** produced after an utterance boundary and expected to remain stable.

No implementation may advertise or assume perfect recognition or translation. The system must expose uncertainty and make model quality measurable.

## Repository Target

Codex should create a monorepo similar to:

```text
valorant-live-translator/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml
├── apps/
│   └── desktop/
├── crates/
│   ├── audio-core/
│   ├── overlay-core/
│   ├── ipc-protocol/
│   └── diagnostics/
├── services/
│   └── inference/
├── models/
│   └── README.md
├── config/
├── fixtures/
├── scripts/
├── tests/
└── docs/
```

## Non-Goals for V1

- DirectX, Vulkan, or OpenGL hooking.
- DLL injection.
- Reading VALORANT process memory or game files.
- Identifying agents, enemies, map state, or tactical events.
- Translating the user's own microphone.
- Reliable player-name attribution.
- Overlapping-speaker transcription.
- Cloud APIs.
- Automatic recording or transcript retention.
- Shipping a custom virtual audio driver.
- True exclusive-fullscreen overlay support.

## Commands Codex Must Eventually Support

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

python -m pytest services/inference/tests
python services/inference/app.py

pnpm --filter desktop tauri dev
pnpm --filter desktop tauri build
```

Exact commands may change during implementation, but the final repository must provide equivalent one-command workflows.

## Phase 0 Setup

Required development tools:

- Windows 11 x64;
- Node.js 22 or later with Corepack;
- pnpm 10.32.1 (pinned by `packageManager`);
- stable Rust with Clippy and rustfmt;
- Python 3.11–3.13;
- `uv`.

From PowerShell:

```powershell
corepack enable
pnpm install --frozen-lockfile
uv sync --frozen --extra dev
.\scripts\check.ps1
```

For the owner’s first RTX 4070 Ti validation, the one-command preparation path checks FFmpeg,
NVIDIA/CUDA visibility, builds the persistent translation worker, downloads both pinned models,
verifies their SHA-256 manifests, and runs the repository checks:

```powershell
.\scripts\prepare_windows.ps1 -AcceptModelLicenses
```

Start the foundation UI:

```powershell
pnpm --filter desktop tauri dev
```

Smoke-test the content-free sidecar:

```powershell
uv run python services/inference/app.py
```

The checks require no models, GPU, audio hardware, VALORANT installation, telemetry, or cloud
service. Windows manual validation evidence is tracked in `docs/PHASE_0_VALIDATION.md`.

## Definition of Done

The project is not done when text appears on screen. It is done when:

- audio routing is understandable and recoverable;
- output monitoring does not create echo or a feedback loop;
- the overlay is readable and never steals game input;
- the application remains outside the game process;
- Tagalog and Taglish fixtures are benchmarked with native-speaker review;
- latency and resource budgets are measured on target hardware;
- raw audio is not persisted by default;
- every failure mode has a user-visible recovery path;
- build, tests, model setup, and installer instructions are reproducible.
