# Phase 0 — Preparation (ADR 013–018, protocol v2 freeze, feature flag)

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 0)

1. ADRs for multi-source audio, identity, strictness, scheduler, provider-neutral catalogs, and VB-CABLE routing are written and approved.
2. v2 IPC schemas are frozen before implementation.
3. `multi_source_audio` feature flag exists; v0.2 behavior is the default when disabled.

## Tasks

### ADRs
- [x] ADR-013: multi-source audio with immutable source identity
- [x] ADR-014: separately installed VB-CABLE, detection-based routing
- [x] ADR-015: editable presentation metadata (names/tags) never used as keys
- [x] ADR-016: per-source language profiles and strictness
- [x] ADR-017: shared bounded inference scheduler
- [x] ADR-018: provider-neutral model catalogs

### Protocol
- [x] Freeze v2 negotiation, audio header, caption snapshot, control messages in `IPC_V2_FREEZE.md`
- [x] Review freeze against protocol v1 sources (Rust `ipc-protocol`, Python `protocol.py`, TS `ipc/model.ts`)

### Feature flag
- [x] `multi_source_audio` in `AppStatus` (Rust), env override `LST_MULTI_SOURCE`
- [x] TS mirror `sources/featureFlag.ts` with tests
- [x] Frontend gating of the Sources tab on the flag (Phase 1)

## Build log

| Date | Action | Evidence |
|---|---|---|
| 2026-08-03 | Reviewed spec §17–§21, existing ADR series, protocol v1 on both sides | `crates/ipc-protocol/src/lib.rs` (PROTOCOL_VERSION 1), `services/inference/.../protocol.py` (PROTOCOL_VERSION 1) |
| 2026-08-03 | Wrote ADR-013 … ADR-018 | files in `docs/adr/` |
| 2026-08-03 | Wrote IPC v2 freeze | `docs/v0_3/IPC_V2_FREEZE.md` |
| 2026-08-03 | Added `multi_source_audio` to `AppStatus` + env override + Rust tests | `apps/desktop/src-tauri/src/lib.rs`; `cargo test -p local-squad-desktop` 5 passed |
| 2026-08-03 | Added TS feature flag module + tests | `apps/desktop/src/sources/featureFlag.ts` (+ test) |
| 2026-08-03 | Fixed env-var race in flag tests (parallel test threads) | `ENV_LOCK` mutex in test module; full workspace `cargo test` green (13+1+6+5+16+2+4 passed) |
| 2026-08-03 | Full checks | `cargo clippy --all-targets` 0 warnings, `cargo fmt --check` clean |

## Notes / observations

- Pre-existing ADR numbering collision: `ADR-011-*` exists twice and `ADR-012-*` twice (model-manager + owner-authorized-offline-clip-lab; packaging + tagalog-whisper-v1). Both ADR-012 files have external references. Renumbering is out of scope for v0.3; recommend a dedicated docs cleanup commit.
- Flag semantics: `LST_MULTI_SOURCE=0` disables; anything else (incl. unset) enables for v0.3 development.

## Files changed
- `docs/adr/ADR-013-…018` (new)
- `docs/v0_3/IPC_V2_FREEZE.md` (new)
- `apps/desktop/src-tauri/src/lib.rs` (AppStatus + flag)
- `apps/desktop/src/sources/featureFlag.ts` + test (new)

## Risks
- v2 freeze will be implemented in Phase 2; any drift is caught by the freeze compliance pass and Phase 2 acceptance tests.

