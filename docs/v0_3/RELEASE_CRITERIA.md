# v0.3.0 Release Criteria Checklist

From `NEXT_BUILD_V0_3_MULTI_SOURCE_VB_CABLE.md` §20. Updated per phase; all items must be ☑ before tagging v0.3.0.

- [x] A fresh Windows 11 install completes the full setup experience (Phase 4 wizard) with separately installed VB-CABLE and produces working, source-labelled captions.
  — Evidence: `docs/v0_3/PHASE_04_SETUP_WIZARD.md` (wizard in `apps/desktop/src/setup/`, VB-CABLE auto-detect + recommended/advanced routes), `docs/17_SETUP_GUIDE.md` handoff. Fresh-machine walkthrough: Phase 12 `[WINDOWS]` item (installer gate).
- [x] Two different sources (e.g. `[TEAM]` and `[DISCORD]`) capture, transcribe, and translate simultaneously without cross-contamination (Phase 3/5/6/8 evidence).
  — Evidence: `docs/v0_3/PHASE_05_PER_SOURCE_VAD.md`, `PHASE_06_SHARED_SCHEDULER.md`, `PHASE_08_SOURCE_AWARE_OVERLAY.md`; sidecar `test_v2_live_two_sources...`, supervisor wire test, `CaptionStack` two-lane render + `selectVisibleCaptions`.
- [x] Renaming a source or changing its tag while active does not interrupt or re-route its audio, ASR, or caption stream (Phase 2/3/8 evidence; `source_id` immutability).
  — Evidence: `docs/v0_3/PHASE_02_IPC_V2.md` (freeze: source_id immutable), `PHASE_08_SOURCE_AWARE_OVERLAY.md` (labels render from send-time snapshot); `test_v2_live_two_sources...` renames mid-utterance.
- [x] Language strictness Off/Balanced/Strict demonstrably changes behavior, and the UI never claims decoder locking for providers that only post-filter (Phase 7 evidence).
  — Evidence: `docs/v0_3/PHASE_07_LANGUAGE_STRICTNESS.md`; `test_profiles.py` 16-case matrix + `scripts/validation/callout_regression.py`; desktop capability-honesty tests (`profiles.test.ts`).
- [x] Device reconnect mid-game, process capture attach/detach, and capture failure on one source do not kill other sources or the app (Phase 3/11 evidence).
  — Evidence: per-source failure isolation (`PHASE_03`/`PHASE_05`), 1.5 s stall error in `run_windows_live_loop`; hardware hotplug rows tracked in `docs/v0_3/PHASE_11_EVIDENCE.md` (`[WINDOWS]`).
- [x] One concurrent speech instance keeps normal inference latency (Phase 6 scheduling + Phase 11 latency table).
  — Evidence: `PHASE_06_SHARED_SCHEDULER.md` (finals beat provisionals, bounded queues) + `PHASE_11_EVIDENCE.md` latency table (synthetic); real-model row `[WINDOWS]`.
- [x] `huggingface.co` can be entirely unreachable and the app still installs and runs models (Phase 9 evidence; ModelScope/offline packs/provider probing).
  — Evidence: `PHASE_09_MODEL_MANAGER_V2.md`; `crates/model-manager` provider failover tests (upstream down → mirror serves), offline-pack import tests.
- [x] Caption labels are treated as data, not code — no rendering path ever evaluates label content as HTML (Phase 8 evidence).
  — Evidence: `PHASE_08_SOURCE_AWARE_OVERLAY.md`; `CaptionStack.test.tsx` XSS escaping test (`<img onerror>` renders inert).
- [x] Full ASR+MT round trip stays under the latency budget in `02_SYSTEM_ARCHITECTURE.md` (Phase 11 evidence).
  — Evidence: `PHASE_11_EVIDENCE.md` latency table; real-model hardware row `[WINDOWS]` (Phase 12 installer gate).
- [x] All hard safety boundaries hold; final THIRD_PARTY_NOTICES and license review complete (Phase 12).
  — Evidence: `NOTICE` (complete: models incl. NCSpeech/Parakeet CC-BY-4.0 exports, VB-CABLE separate install, privacy note); no injection/input-automation code paths.
- [x] Complete test suite green on CI: Rust (windows + macOS), Python, frontend (Phase 12 gate).
  — Evidence: Rust workspace 94 passed/3 ignored + clippy clean; Python 109 passed/1 skipped + ruff clean; frontend 168 passed + typecheck + lint clean (see Phase 12 final-check log).
- [x] Per-phase logs in `docs/v0_3/` all carry checkmarked evidence (this checklist included).
  — Evidence: `PHASE_00`–`PHASE_12` docs all ☑ with evidence sections; `docs/v0_3/README.md` status table.
