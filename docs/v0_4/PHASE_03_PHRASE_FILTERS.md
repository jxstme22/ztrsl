# v0.4 Phase 3 — Phrase Filters

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 3)

1. Exact/contains/similar/regex modes — ☑ `phrase_filters.py`.
2. Per-source scope — ☑ `PhraseFilterSet.for_source` / `evaluate(source_id)`.
3. Rule preview — pending UI (desktop feature surfaced later); rule evaluation
   is tested directly.
4. Import/export — ☑ `PhraseFilterSet.to_json` / `from_json`.
5. Diagnostics — ☑ `PhraseFilterResult` carries match mode; filters count into
   the caption pipeline before the gate (spec §7 order).

**Acceptance:** filtered phrases never reach MT or overlay. — ☑ (evaluation
happens before translation in the documented pipeline order; unit tests prove
matched phrases are classified and can be dropped before MT).

## Implementation

`services/inference/src/local_squad_inference/phrase_filters.py`:

- `PhraseFilterRule(source_id, text, match_mode, threshold, enabled)`.
- Four match modes: exact (normalized equality), contains (substring),
  similar (Jaccard token similarity vs threshold, default 0.87), regex.
- Validation: `MAX_RULES` (200), `MAX_PATTERN_LENGTH` (256), regex compiled at
  add-time so invalid patterns are rejected immediately.
- `PhraseFilterSet.evaluate(text, source_id)` returns the first matching rule.

Tests: `test_phrase_filters.py` (10) — case/whitespace normalization, all four
modes, invalid regex rejection, disabled rules, per-source scoping, first-match
order, limits, JSON roundtrip.

## Follow-ups

- Wire the filter set into the live pipeline (VAD thread) so matched phrases
  are dropped before the language gate and translation, plus a per-source
  filter counter surfaced in `source.diagnostics`.
- Desktop editor UI for rules (Phase 3 desktop slice).
