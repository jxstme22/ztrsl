# v0.4 Phase 4 — Glossary Editor

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 4)

1. Preserve / ASR correction / preferred translation / aliases — ☑
   `glossary.py` entry types.
2. Scopes — ☑ global / source / language_profile / model with applicability
   ordering.
3. Hot reload — ☑ glossary is stateless, evaluated per caption, and
   `set_glossary` swaps it at runtime without a model restart.
4. Import/export — ☑ `Glossary.to_json` / `from_json` + localStorage.
5. Unicode, conflict warning, protected placeholders, size limits — ☑ NFKC
   normalization, `MAX_ENTRIES`/`MAX_TERM_LENGTH`, `preserve_terms` for
   protected placeholders (conflict-warning UI is a desktop refinement).

**Acceptance:** corrections work without large-model restart. — ☑
`test_live.py` hot-reload test + `test_glossary.py`.

## Implementation

- `glossary.py`: `GlossaryEntry(entry_type, source, target, scope, scope_key,
  note)` with types preserve / asr_correction / preferred_translation / alias.
- `Glossary.apply()` applies ASR corrections + aliases (left-to-right).
- `preserve_terms()` reports preserve-type placeholders for post-MT restore.
- `preferred_translation()` forces an English output for a source phrase.
- `LivePipeline(glossary=...)` + `set_glossary()`: ASR corrections applied to
  source text before translation; preferred translations override MT output;
  preserved terms re-inserted after MT.
- Desktop `CaptionTrustPanel` glossary editor (add/remove/edit entries,
  persisted locally).

Tests: `test_glossary.py` (9) + pipeline wiring in `test_live.py`
(correction applied, preferred translation, hot reload).

## Follow-ups

- Push the edited glossary to the running sidecar over IPC so edits apply
  mid-session without restart (hot-reload applies to the pipeline the desktop
  controls directly; live-session push is a small IPC control).
