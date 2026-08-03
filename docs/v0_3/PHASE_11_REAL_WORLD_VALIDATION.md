# Phase 11 — Real-World Validation

**Status:** ☑ harnesses built + automated matrix green; hardware-tagged rows
tracked in [PHASE_11_EVIDENCE.md](PHASE_11_EVIDENCE.md) pending a Windows 11
machine

## Acceptance criteria (spec §17 Phase 11)

1. Hardware test matrix passes: VB-CABLE routing, process capture, Unicode tags, rename-while-active, device reconnect, simultaneous sources, strictness matrix, callouts, isolation.
2. Game audio must never appear in the TEAM ASR path (leakage test).
3. Callout regression set passes.

## Tasks (test matrix, all hardware-tagged, on Windows 11)
- [ ] VB-CABLE present: recommended + advanced routing
- [ ] Process capture: game attach/detach mid-session
- [ ] Unicode + emoji caption tags render correctly
- [ ] Rename source + change tag while active — no stream interruption
- [ ] Device reconnect (USB audio unplug/replug) — app recovers, other sources keep running
- [ ] Two simultaneous sources — independent captions + metrics
- [ ] Strictness matrix on real speech (Off/Balanced/Strict × profiles)
- [ ] Callout regression set (numbers, positions, "rotating", short commands)
- [ ] Isolation/leakage test passes
- [ ] Latency table: full ASR+MT round trip vs budget
- [ ] Session-long stability run (memory + GPU residency)

## Files (expected)
- `docs/v0_3/PHASE_11_EVIDENCE.md` (full results + timestamps + machine info)
- Optional: `scripts/validation/*` harnesses

## Evidence policy
Every matrix row gets a dated run with hardware details and pass/fail; failures reopen the owning phase's log.
