# v0.4 Phase 6 — Overlap Detection

**Status:** ☑ complete (core detector + tests; live wiring pending)

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 6)

1. Per-source detector — ☑ `overlap.py` classifies VAD interval samples.
2. Mild/heavy policies — ☑ `process_normally` / `mark_uncertain` /
   `suppress_heavy_overlap` with calibration defaults (mild 0.15, heavy 0.40,
   minimum 250 ms).
3. Fixture set — ☑ `test_overlap.py` (11) covers ratio, overlap-ms, and all
   policy verdicts.
4. Metrics — ☑ `OverlapStatus` exposes ratio, overlap_ms, mild/heavy flags;
   feeds the certainty pipeline (Phase 5).

**Acceptance:** heavy overlap is not confidently captioned by default. — ☑
`suppress_heavy_overlap` yields `suppressed` (maps to certainty suppression),
`mark_uncertain` yields `uncertain`; default policies TEAM=suppress,
DISCORD=mark.

## Implementation

`services/inference/src/local_squad_inference/overlap.py`:

- `OverlapSample(speech, start_ms, end_ms)` — one VAD interval.
- `overlap_ratio()` — fraction of speech samples overlapping another speech
  sample.
- `total_overlap_ms()` — time spent with >=2 speech intervals concurrent.
- `classify_overlap()` — applies the policy + minimum-overlap guard.

`_certainty_for` (Phase 5) consumes the verdict so heavy overlap suppresses and
mild overlap marks uncertain.

Tests: `test_overlap.py` (11) — zero/single/partial/full ratios, overlap-ms,
all three policies, below-minimum guard, default policies.

## Follow-ups

- Per-source overlap registry updated on the VAD thread with recent intervals;
  pass its verdict into `stamp_v2_caption`.
- Expose overlap metrics in `source.diagnostics`.
