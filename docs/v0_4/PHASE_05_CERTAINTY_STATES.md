# v0.4 Phase 5 — Certainty States

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 5)

1. IPC schema — ☑ `CaptionCertainty` in Python protocol + Rust ipc-protocol
   (`state`, `uncertainty_reasons`, `suppression_reason`); v1 sessions strip it.
2. State reducer — ☑ desktop overlay `captionCertaintySchema`; suppressed
   captions are filtered out of the overlay lanes.
3. Overlay rendering — ☑ `CaptionStack` renders uncertain captions distinctly
   (`[TEAM?]` marker, "Uncertain" state, reason list) and never flashes
   suppressed content.
4. Suppressed reasons — ☑ `suppression_reason` (heavy_overlap, low_confidence,
   unexpected_language, phrase_filter, clipping).
5. Final-state behavior — ☑ final captions remain terminal (reducer unchanged);
   suppression filters before dispatch.

**Acceptance:** uncertain output is visibly distinct. — ☑
`CaptionStack.test.tsx` uncertain-rendering test.

## Implementation

- Python `protocol.py`: `CaptionCertainty` model + `CaptionPayload.certainty`,
  added to the v2 wire (stripped for v1).
- Rust `ipc-protocol`: `CaptionCertainty` struct + `certainty` field; round-trip
  and v1-stripping tests updated.
- Sidecar `stamp_v2_caption` builds certainty from the language gate + per-source
  overlap verdict (`_certainty_for`): gate `suppressed` -> suppressed; flagged ->
  unexpected_language; low confidence -> low_asr_confidence; overlap verdict
  uncertain/suppressed -> overlapping_speech / heavy_overlap.
- Desktop: `ipc/model.ts` certainty schema, overlay model certainty, live
  mapping (suppressed dropped), `CaptionStack` distinct uncertain rendering.

Tests: `test_certainty.py` (7), `CaptionStack.test.tsx` uncertain case,
ipc-protocol Rust round-trip + v1 stripping.

## Follow-ups

- Thread live overlap verdicts into `stamp_v2_caption` via a per-source overlap
  registry (Phase 6 wiring).
