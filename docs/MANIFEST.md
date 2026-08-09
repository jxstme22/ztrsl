# Package Manifest

Generated: 2026-07-29

| File | Purpose |
|---|---|
| `README.md` | Entry point and stack summary |
| `AGENTS.md` | Binding instructions for Codex |
| `docs/00_EXECUTIVE_SUMMARY.md` | Product and delivery overview |
| `docs/01_PRD.md` | Functional and non-functional requirements |
| `docs/02_SYSTEM_ARCHITECTURE.md` | Processes, data flow, concurrency, interfaces |
| `docs/03_WINDOWS_AUDIO_ROUTING.md` | WASAPI, virtual cable, monitoring, recovery |
| `docs/04_ASR_TRANSLATION_PIPELINE.md` | VAD, ASR, MT, stabilization, glossary |
| `docs/05_OVERLAY_AND_DESKTOP_APP.md` | Overlay behavior and UI |
| `docs/06_DATA_MODELS_AND_PROTOCOLS.md` | IPC, schemas, settings, errors |
| `docs/07_BUILD_PLAN.md` | Sequential implementation phases |
| `docs/08_TEST_AND_BENCHMARK_PLAN.md` | Quality, latency, resource and security tests |
| `docs/09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md` | Hard safety and compliance boundaries |
| `docs/10_RELEASE_INSTALLER_OPERATIONS.md` | Packaging, models, updates, uninstall |
| `docs/11_RISK_REGISTER.md` | Risks and mitigations |
| `docs/12_CODEX_TASK_PROMPTS.md` | Copy-ready phase prompts for Codex |
| `docs/13_SOURCE_NOTES.md` | Primary sources and verification notes |
| `docs/14_DECISIONS_AND_OPEN_QUESTIONS.md` | Accepted decisions and benchmark questions |
| `docs/15_ACCEPTANCE_CHECKLIST.md` | Final audit checklist |
| `docs/PHASE_0_VALIDATION.md` | Phase 0 evidence and deferred Windows checks |
| `docs/PHASE_1_VALIDATION.md` | Phase 1 overlay evidence and Windows acceptance matrix |
| `docs/PHASE_2_VALIDATION.md` | Phase 2 audio evidence and Windows hardware acceptance matrix |
| `docs/PHASE_3_VALIDATION.md` | Phase 3 routing-core evidence and Windows playback gates |
| `docs/PHASE_4_VALIDATION.md` | Phase 4 authenticated IPC and fake-sidecar evidence |
| `docs/adr/` | Required architecture decision records and template |
| `brand.md` | Deferred brand decision; neutral accessible theme is active |
| `apps/desktop/` | Tauri 2 and strict React/TypeScript desktop foundation |
| `crates/audio-core/` | Endpoint contracts, Windows catalog/notifications, synthetic source, and bounded metering |
| `crates/overlay-core/` | Caption lifecycle state core |
| `crates/ipc-protocol/` | Versioned local protocol primitives and limits |
| `crates/sidecar-supervisor/` | Per-launch authenticated Python sidecar lifecycle and WebSocket client |
| `crates/diagnostics/` | Content-free diagnostic metrics |
| `services/inference/` | Python 3.11+ local sidecar foundation |
| `.github/workflows/ci.yml` | Model-free automated checks |
| `scripts/check.ps1` | One-command Windows validation workflow |
