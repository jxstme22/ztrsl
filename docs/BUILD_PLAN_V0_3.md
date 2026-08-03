# v0.3.0 Build Plan — Multi-Source Audio, Editable Source Tags, Language Strictness, VB-CABLE

Source of truth: `NEXT_BUILD_V0_3_MULTI_SOURCE_VB_CABLE.md` (v0.3.0 build specification).

**Target:** v0.3.0 · Windows 11 x64 · built on beta v0.2.0.

**Central design rule (from the spec):**

> Separate audio sources before ASR, preserve immutable source identity through the pipeline, let users freely edit presentation names and tags, enforce language behavior per source, and share expensive models only at the bounded inference scheduler.

## Working agreements

- Every phase: restate acceptance criteria → smallest complete vertical slice → unit/integration tests → run formatting, linting, type checking, tests → update docs → record evidence in the phase log.
- Never mark a phase complete from compilation alone.
- Hard safety boundaries unchanged (no injection, hooks, memory reads, packet inspection, input automation, network audio, default content persistence).
- VB-CABLE is always separately installed by the user; xTRSNLTR only detects and uses its endpoints.
- CI must stay independent of real audio hardware and large model downloads.
- Source identity: `source_id` is immutable; `display_name` and `caption_tag` are editable presentation metadata and must never be used as queue/IPC/persistence/revision keys.

## Phase map

| Phase | Name | Depends on | Primary deliverables | Acceptance (short form) |
|---|---|---|---|---|
| 0 | Preparation | — | ADRs 013–018, protocol v2 freeze, `multi_source_audio` feature flag | identity rules, strictness, schemas, migration reviewed before implementation |
| 1 | Source configuration, editable names/tags, migration | 0 | source domain model (TS), presets, validation, schema v3 + v0.2 migration, source editor with live caption preview | one migrated source renders `[TEAM] Example caption`; rename does not change internal ID |
| 2 | IPC v2 | 1 | `source_id` in audio headers, presentation snapshot in captions, strictness/filter fields, `source.presentation.update`, v1/v2 negotiation, multi-source fake sidecar | fake TEAM + DISCORD sources produce independent captions; renaming DISCORD does not affect TEAM revisions |
| 3 | Multiple audio pipelines | 2 | `audio-core` source registry, concurrent endpoint/process captures, per-source buffers/resamplers/meters/sequences/monitoring, isolated failures | two arbitrarily named sources run simultaneously without cross-contamination |
| 4 | VB-CABLE and source setup wizard | 3 | VB-CABLE detection, recommended/advanced modes, routing wizard (steps 1–11), isolation + monitoring tests, reusable presets | setup needs no manual config editing; wizard never implies VB-CABLE is bundled |
| 5 | Per-source VAD | 4 | per-source VAD + utterance state keyed by immutable ID, per-source start/stop/flush/diagnostics | simultaneous source speech → independent utterances; tag edits do not interrupt capture |
| 6 | Shared scheduler | 5 | bounded ASR/translation queues, source priorities, stale provisional coalescing, final-job preservation, overload handling + metrics | model VRAM shared, not duplicated; tag edits never change priority |
| 7 | Language profiles and strictness | 6 | profile catalog, Off/Balanced/Strict per source, forced/preferred/post-filtered capability honesty, language gate, tactical bypass, glossaries, English-skip, filter diagnostics | strictness changes real behavior; UI never claims decoder locking for post-filter-only providers |
| 8 | Source-aware overlay | 7 | primary/secondary lanes, editable tags, all label styles, simultaneous policies, per-source expiration, hide-source, escaped labels | `[TEAM] Rotate B!` + `[DISCORD] Let's go!` render independently; no cross-source overwrite |
| 9 | Model manager v2 | 8 | capabilities + recommended profiles, provider lists/probing/failover, ModelScope + mainland-CN providers, signed catalogs, offline packs, custom HF endpoint preserved | Hugging Face availability is not required |
| 10 | Diagnostics | 9 | per-source health/metrics, scheduler metrics, language-filter metrics, leakage test, content-free support data | users can diagnose wrong routing, missing process/model, strictness/provider behavior, overload, monitoring failures |
| 11 | Real-world validation | 10 | hardware-driven test matrix (cables, process capture, Unicode tags, rename-while-active, device reconnect, simultaneous sources, strictness matrix, callouts, isolation) | correctly routed game audio absent from TEAM ASR; labels source-correct; callout regression set passes |
| 12 | Installer and documentation | 11 | THIRD_PARTY_NOTICES, VB-CABLE handoff, docs 17–23, installer checks | clean Windows user completes full setup with separately installed VB-CABLE |

## Sequencing notes

- Phases 1–2 are safe on any platform (models + protocol). Phase 3+ is Windows-hardware-heavy; unit-testable parts land first, hardware acceptance is tagged and CI-skippable.
- The fake-sidecar pattern (already used in `IpcPanel`) is extended in Phase 2 to cover multi-source caption independence.
- Release criteria (spec §20) are tracked in `docs/v0_3/RELEASE_CRITERIA.md`.

## Per-phase logs

Every phase has a log file in `docs/v0_3/`:

| Phase | Log |
|---|---|
| 0 | `docs/v0_3/PHASE_00_PREPARATION.md` |
| 1 | `docs/v0_3/PHASE_01_SOURCES_AND_IDENTITY.md` |
| 2 | `docs/v0_3/PHASE_02_IPC_V2.md` |
| 3 | `docs/v0_3/PHASE_03_MULTI_PIPELINES.md` |
| 4 | `docs/v0_3/PHASE_04_SETUP_WIZARD.md` |
| 5 | `docs/v0_3/PHASE_05_PER_SOURCE_VAD.md` |
| 6 | `docs/v0_3/PHASE_06_SHARED_SCHEDULER.md` |
| 7 | `docs/v0_3/PHASE_07_LANGUAGE_STRICTNESS.md` |
| 8 | `docs/v0_3/PHASE_08_SOURCE_AWARE_OVERLAY.md` |
| 9 | `docs/v0_3/PHASE_09_MODEL_MANAGER_V2.md` |
| 10 | `docs/v0_3/PHASE_10_DIAGNOSTICS.md` |
| 11 | `docs/v0_3/PHASE_11_REAL_WORLD_VALIDATION.md` |
| 12 | `docs/v0_3/PHASE_12_INSTALLER_AND_DOCS.md` |
