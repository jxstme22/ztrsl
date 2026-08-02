# Project Documentation

This is the formal documentation set for xTRSNLTR. Read it in the order below
for the full picture; read `15_ACCEPTANCE_CHECKLIST.md` and `01_PRD.md` as the
source of truth when there is ambiguity.

## Quick start

| Doc | What it is |
|---|---|
| [00_EXECUTIVE_SUMMARY.md](./00_EXECUTIVE_SUMMARY.md) | Product and delivery overview |
| [01_PRD.md](./01_PRD.md) | Functional and non-functional requirements |
| [15_ACCEPTANCE_CHECKLIST.md](./15_ACCEPTANCE_CHECKLIST.md) | Final audit checklist |
| [02_SYSTEM_ARCHITECTURE.md](./02_SYSTEM_ARCHITECTURE.md) | Processes, data flow, concurrency, interfaces |
| [07_BUILD_PLAN.md](./07_BUILD_PLAN.md) | Sequential implementation phases |

## Deep dives

- [03_WINDOWS_AUDIO_ROUTING.md](./03_WINDOWS_AUDIO_ROUTING.md) — WASAPI,
  virtual cable, monitoring, recovery.
- [04_ASR_TRANSLATION_PIPELINE.md](./04_ASR_TRANSLATION_PIPELINE.md) — VAD,
  ASR, MT, provisional/final captions, language tokens.
- [05_OVERLAY_AND_DESKTOP_APP.md](./05_OVERLAY_AND_DESKTOP_APP.md) — overlay
  behavior and UI.
- [06_DATA_MODELS_AND_PROTOCOLS.md](./06_DATA_MODELS_AND_PROTOCOLS.md) — IPC,
  schemas, settings, errors.
- [08_TEST_AND_BENCHMARK_PLAN.md](./08_TEST_AND_BENCHMARK_PLAN.md) — quality,
  latency, resource and security tests.
- [09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md](./09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md)
  — hard safety and compliance boundaries (authority #1).
- [10_RELEASE_INSTALLER_OPERATIONS.md](./10_RELEASE_INSTALLER_OPERATIONS.md) —
  packaging, models, updates, uninstall.
- [11_RISK_REGISTER.md](./11_RISK_REGISTER.md) — risks and mitigations.
- [13_SOURCE_NOTES.md](./13_SOURCE_NOTES.md) — primary sources and verification.
- [14_DECISIONS_AND_OPEN_QUESTIONS.md](./14_DECISIONS_AND_OPEN_QUESTIONS.md) —
  accepted decisions and open benchmark questions.

## Phase evidence

Each phase has a validation doc with `[ ]` checkboxes and benchmark output:
`PHASE_0_VALIDATION.md` … `PHASE_6_LIVE_VALIDATION.md`, plus
`PHASE_5_CLIP_LAB_VALIDATION.md`.

## Architecture decision records

See [`adr/`](./adr/) for the accepted ADRs:

- ADR-001 audio routing (virtual cable vs loopback)
- ADR-002 inference sidecar (Python vs native)
- ADR-003 provisional/final caption lifecycle
- ADR-004 model artifacts
- ADR-005 overlay window
- ADR-006 GPU resource governance
- ADR-007 data retention defaults
- ADR-008 macOS-first overlay development
- ADR-009 cross-platform audio development sequencing
- ADR-010 owner-authorized phase sequencing
- ADR-011 in-app model manager
- ADR-012 packaging (PyInstaller sidecar + Tauri externalBin)
