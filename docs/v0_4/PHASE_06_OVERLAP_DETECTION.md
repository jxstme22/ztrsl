# v0.4 Phase 6 — Overlap Detection

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 6)

1. Per-source detector — ☑ `overlap.py` + `_OverlapTracker` fed by the VAD
   thread.
2. Mild/heavy policies — ☑ `process_normally` / `mark_uncertain` /
   `suppress_heavy_overlap` with calibration defaults (mild 0.15, heavy 0.40,
   minimum 250 ms).
3. Fixture set — ☑ `test_overlap.py` (11) + tracker tests in `test_certainty.py`.
4. Metrics — ☑ `OverlapStatus` exposes ratio, overlap_ms, mild/heavy flags and
   feeds the certainty pipeline (Phase 5).

**Acceptance:** heavy overlap is not confidently captioned by default. — ☑
`suppress_heavy_overlap` yields `suppressed` (maps to certainty suppression),
`mark_uncertain` yields `uncertain`; wired into `stamp_v2_caption` so live
captions carry the verdict.

## Implementation

- `overlap.py`: `OverlapSample`, `overlap_ratio()`, `total_overlap_ms()`,
  `classify_overlap()`.
- `sidecar._OverlapTracker`: per-source utterance-span registry updated on the
  VAD thread; rapid back-to-back speakers (gap < minimum_overlap_ms) are
  flagged as overlap; `status_for(source_id)` applies the per-source policy.
- `stamp_v2_caption(overlap_status=...)` feeds the verdict into `_certainty_for`:
  suppressed verdict -> `heavy_overlap` suppression; uncertain -> `overlapping_speech`.
- The live drain/control paths pass `live_worker._overlap.status_for` so live
  captions carry certainty.

Tests: `test_overlap.py` (11) + `test_certainty.py` tracker/verdict tests.

## Notes

A single source's VAD stream cannot segment two simultaneous speakers, so
overlap is detected as rapid turn-taking (an utterance closing and the next
opening within `MINIMUM_OVERLAP_MS`) — a real, honest per-source multi-speaker
proxy. Default policy per source is `mark_uncertain` (safe); TEAM's
`suppress_heavy_overlap` default can be set via the tracker's per-source
policy.
