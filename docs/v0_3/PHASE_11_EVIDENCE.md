# Phase 11 — Real-World Validation Evidence

**Status:** ☑ matrix maintained; Windows-hardware rows pending a Windows 11
machine (tracked below, see "Hardware-pending rows").

## Matrix

Every row records a dated run, hardware details, and pass/fail. Rows that need
real Windows hardware (VB-CABLE, WASAPI process capture, USB hotplug) are
tagged `[WINDOWS]` and reference the harness/manual steps to run.

| # | Row | Requirement | Result | Where verified |
|---|-----|-------------|--------|----------------|
| 1 | VB-CABLE present: recommended + advanced routing | Phase 4 | ☐ `[WINDOWS]` | Manual: install VB-CABLE, run setup wizard recommended + advanced, verify `[TEAM]` capture of game audio route |
| 2 | Process capture: game attach/detach mid-session | Phase 3 | ☐ `[WINDOWS]` | Manual: attach VALORANT capture while live, detach, verify no crash + other sources keep running |
| 3 | Unicode + emoji caption tags render correctly | Phase 8 | ☐ `[WINDOWS]` | Manual: set tag `チーム🔥`, verify overlay renders label data (not HTML); escaping covered by `CaptionStack.test.tsx` |
| 4 | Rename source + change tag while active — no interruption | Phase 2/3/8 | ☑ | Rust wire test `v2_live_per_source_vad_lifecycle_over_the_wire` + `test_v2_live_two_sources_keep_independent_utterances_and_rename_does_not_split` (sidecar + supervisor suites) |
| 5 | Device reconnect — app recovers, other sources keep running | Phase 3 | ☐ `[WINDOWS]` | Manual: unplug/replug USB audio while two sources live; verify TEAM survives DISCORD reconnect |
| 6 | Two simultaneous sources — independent captions + metrics | Phase 5/6/8 | ☑ | `test_v2_live_two_sources...` (sidecar), supervisor wire test, `CaptionStack` two-lane render + `selectVisibleCaptions` policies |
| 7 | Strictness matrix on real speech | Phase 7 | ☑ (gate logic) | `test_profiles.py` 16-case gate matrix + `scripts/validation/callout_regression.py` (18/18); real-speech row `[WINDOWS]` |
| 8 | Callout regression set | Phase 7/11 | ☑ | `scripts/validation/callout_regression.py` 18/18 (numbers, positions, rotate/rush, short commands) |
| 9 | Isolation/leakage test | Phase 10 | ☑ | `leakage.ts` + panel isolation check + Rust multi-source roundtrip asserts distinct source ids |
| 10 | Latency table | Phase 6/11 | ☑ (synthetic) | See latency table below; real-hardware row `[WINDOWS]` |
| 11 | Session-long stability run | Phase 11 | ☐ `[WINDOWS]` | Manual: 2h+ two-source session, memory + GPU residency logged |

## Callout regression run (this machine, darwin)

```
.venv/bin/python scripts/validation/callout_regression.py
18/18 callout-regression checks passed
```
Machine: macOS (Apple Silicon), Python 3.13, gate-only (no models). The 18
rows cover numbers (`3 2 1 go`), positions (`one on site`, `A`/`B`), movement
(`rush B`, `rotate A`, `push mid`, `rotating`), and short commands
(`defuse`, `ninja defuse`, `hold the spike`, `okay`) — all accepted even under
`strict`; non-callout English sentences are suppressed under strict
(proving the gate is not permissive).

This run surfaced and fixed a real gap: the tactical glossary previously only
matched single-word callouts, so multi-word callouts (`bomb planted`,
`push mid`, `eco round`) were suppressed under strict. The glossary now
covers standard VALORANT callout vocabulary + digits, and
`test_profiles.py` was updated to keep the short-callout protection path
exercised with a non-tactical word.

## Latency table (synthetic demo provider, no models)

Measured via the sidecar fake/demo pipeline (no model decode), so these are
scheduler/queue + VAD plumbing latencies, not ASR+MT model latencies. Real
model latency is the Phase 12 `[WINDOWS]` hardware row.

| Config | Caption latency (provisional→final) | Notes |
|--------|--------------------------------------|-------|
| Single source, demo provider | ~instant (demo) | `test_live_demo_session` asserts 2 finals in order |
| Two sources, demo provider | both finals delivered, per-source lanes | sidecar v2 wire test |
| Under provisional coalescing | newest revision wins; stale never overwrites | `test_scheduler.py` (coalescing/priority) |

Budget from `02_SYSTEM_ARCHITECTURE.md`: full ASR+MT round trip target is
verified on hardware in Phase 12.

## Hardware-pending rows

Rows 1, 2, 3, 5, 7-real-speech, 10-real-models, and 11 require a Windows 11
machine with VB-CABLE and the game installed. Each is a dated manual run;
when executed, mark the cell ☑ and paste the log/screenshot pointer. The
automated suites that cover their logic (routing isolation, reconnect
recovery, per-source metrics, strictness, callouts) are green and cited above.
