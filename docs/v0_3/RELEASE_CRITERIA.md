# v0.3.0 Release Criteria Checklist

From `NEXT_BUILD_V0_3_MULTI_SOURCE_VB_CABLE.md` §20. Updated per phase; all items must be ☑ before tagging v0.3.0.

- [ ] A fresh Windows 11 install completes the full setup experience (Phase 4 wizard) with separately installed VB-CABLE and produces working, source-labelled captions.
- [ ] Two different sources (e.g. `[TEAM]` and `[DISCORD]`) capture, transcribe, and translate simultaneously without cross-contamination (Phase 3/5/6/8 evidence).
- [ ] Renaming a source or changing its tag while active does not interrupt or re-route its audio, ASR, or caption stream (Phase 2/3/8 evidence; `source_id` immutability).
- [ ] Language strictness Off/Balanced/Strict demonstrably changes behavior, and the UI never claims decoder locking for providers that only post-filter (Phase 7 evidence).
- [ ] Device reconnect mid-game, process capture attach/detach, and capture failure on one source do not kill other sources or the app (Phase 3/11 evidence).
- [ ] One concurrent speech instance keeps normal inference latency (Phase 6 scheduling + Phase 11 latency table).
- [ ] `huggingface.co` can be entirely unreachable and the app still installs and runs models (Phase 9 evidence; ModelScope/offline packs/provider probing).
- [ ] Caption labels are treated as data, not code — no rendering path ever evaluates label content as HTML (Phase 8 evidence).
- [ ] Full ASR+MT round trip stays under the latency budget in `02_SYSTEM_ARCHITECTURE.md` (Phase 11 evidence).
- [ ] All hard safety boundaries hold; final THIRD_PARTY_NOTICES and license review complete (Phase 12).
- [ ] Complete test suite green on CI: Rust (windows + macOS), Python, frontend (Phase 12 gate).
- [ ] Per-phase logs in `docs/v0_3/` all carry checkmarked evidence (this checklist included).
