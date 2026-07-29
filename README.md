# Local Live Translator Overlay for VALORANT

A Codex-ready specification pack for a **fully local Windows desktop companion** that:

- listens to incoming party/team voice routed from VALORANT;
- recognizes **Tagalog/Filipino, Cebuano, English, and code-switched speech**;
- translates non-English speech into English;
- displays low-latency subtitles in a transparent, click-through overlay;
- does not inject into, read memory from, automate, or modify VALORANT;
- keeps raw audio and transcripts local by default.

> Research and planning snapshot: **2026-07-29**  
> Primary target hardware: **Windows 11 + NVIDIA RTX 4070 Ti (12 GB assumed)**  
> Initial application type: **personal/local prototype**, followed by a distributable product only after policy review and registration.

## Current Implementation

Phase 0 and the macOS-buildable portions of Phases 1 through 4 are now implemented:

- Tauri 2 desktop control-window foundation with React and strict TypeScript;
- Rust workspace crates for audio boundaries, caption state, IPC protocol, and content-free diagnostics;
- Python 3.11+ inference-sidecar skeleton with strict Pydantic payloads;
- bounded queue and failure-path unit tests;
- CI for frontend, Python, and Windows Rust checks;
- all required architecture decisions plus the macOS-first sequencing record;
- separate transparent/topmost Tauri caption overlay;
- click-through play mode and interactive edit mode;
- fake provisional-to-final caption lifecycle;
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

No real monitoring playback, audio recording, game interaction, model inference, or model download
is active on macOS. Windows overlay and audio hardware acceptance remain deferred under ADR-008
through ADR-010; see the Phase 1–4 validation records. The Phase 4 sidecar uses fake providers and
the project Python environment, not packaged models.

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
| Live ASR | Omnilingual ASR CTC 300M int8 through sherpa-onnx |
| Quality candidate | Omnilingual ASR CTC 1B int8, benchmark-gated |
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
- Tagalog, Cebuano, English, and mixed fixtures are benchmarked;
- latency and resource budgets are measured on target hardware;
- raw audio is not persisted by default;
- every failure mode has a user-visible recovery path;
- build, tests, model setup, and installer instructions are reproducible.
