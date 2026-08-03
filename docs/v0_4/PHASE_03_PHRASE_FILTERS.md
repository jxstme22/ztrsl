# v0.4 Phase 3 — Phrase Filters

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 3)

1. Exact/contains/similar/regex modes — ☑ `phrase_filters.py`.
2. Per-source scope — ☑ `PhraseFilterSet.for_source` / `evaluate(source_id)`.
3. Rule preview — ☑ `CaptionTrustPanel` editor edits rules live; evaluation is
   unit-tested.
4. Import/export — ☑ `PhraseFilterSet.to_json` / `from_json` + localStorage.
5. Diagnostics — ☑ `phrase_filtered` counter in per-source diagnostics; filters
   run before the gate and translation (spec §7 order).

**Acceptance:** filtered phrases never reach MT or overlay. — ☑ wired into
`LivePipeline._transcribe_utterance` before translation; a matched phrase is
dropped and counted (`state.phrase_filtered`), surfaced in `diagnostics_for`.

## Implementation

- `phrase_filters.py`: `PhraseFilterRule` + `PhraseFilterSet` (four modes,
  validation limits, first-match, JSON).
- `LivePipeline(phrase_filters=...)` + `set_phrase_filters()`: hot-reloadable
  per-source set evaluated before translation; matched utterances are dropped.
- Desktop `CaptionTrustPanel` phrase-filters editor (add/remove/edit, persisted
  locally).

Tests: `test_phrase_filters.py` (10) + pipeline wiring in `test_live.py`
(drops before MT, per-source scoping, counted).

## Follow-ups

- Push the edited rule set to the running sidecar over IPC so edits apply
  mid-session without restart (currently hot-reload applies to the pipeline
  the desktop controls directly; live-session push is a small IPC control).
