# v0.3.0 Build Logs — Multi-Source Audio (Index)

Execution of `NEXT_BUILD_V0_3_MULTI_SOURCE_VB_CABLE.md`. Master plan: `../BUILD_PLAN_V0_3.md`.

Status legend: ☐ not started · ◐ in progress · ☑ complete

## Phase status

| Phase | Log | Status |
|---|---|---|
| 0 | [Preparation](PHASE_00_PREPARATION.md) | ☑ |
| 1 | [Source configuration, names/tags, migration](PHASE_01_SOURCES_AND_IDENTITY.md) | ☑ |
| 2 | [IPC v2](PHASE_02_IPC_V2.md) | ☐ |
| 3 | [Multiple audio pipelines](PHASE_03_MULTI_PIPELINES.md) | ☐ |
| 4 | [VB-CABLE and setup wizard](PHASE_04_SETUP_WIZARD.md) | ☑ |
| 5 | [Per-source VAD](PHASE_05_PER_SOURCE_VAD.md) | ☑ |
| 6 | [Shared scheduler](PHASE_06_SHARED_SCHEDULER.md) | ☐ |
| 7 | [Language profiles and strictness](PHASE_07_LANGUAGE_STRICTNESS.md) | ☐ |
| 8 | [Source-aware overlay](PHASE_08_SOURCE_AWARE_OVERLAY.md) | ☑ |
| 9 | [Model manager v2](PHASE_09_MODEL_MANAGER_V2.md) | ☑ |
| 10 | [Diagnostics](PHASE_10_DIAGNOSTICS.md) | ☐ |
| 11 | [Real-world validation](PHASE_11_REAL_WORLD_VALIDATION.md) | ☐ |
| 12 | [Installer and documentation](PHASE_12_INSTALLER_AND_DOCS.md) | ☐ |

[Release criteria](RELEASE_CRITERIA.md) · [IPC v2 freeze](IPC_V2_FREEZE.md) · [ADR series](../adr/) (Phase 0 adds ADR-013 … ADR-018)

## Evidence policy

Every phase entry records: commands run (with output), test counts, lint/typecheck results,
and — where hardware is involved — the exact machine, device, and reproduction steps.
A checkbox is only checked with evidence attached in the same log.
