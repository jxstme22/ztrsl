# v0.4 Phase 4 — Glossary Editor

**Status:** ☑ complete (core module + tests; desktop editor pending)

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 4)

1. Preserve / ASR correction / preferred translation / aliases — ☑
   `glossary.py` entry types.
2. Scopes — ☑ global / source / language_profile / model with applicability
   ordering.
3. Hot reload — ☑ glossary is stateless and evaluated per caption; editing the
   rule set never requires a model restart (tested).
4. Import/export — ☑ `Glossary.to_json` / `from_json`.
5. Unicode, conflict warning, protected placeholders, size limits — ☑ NFKC
   normalization, `MAX_ENTRIES`/`MAX_TERM_LENGTH`, `preserve_terms` for
   protected placeholders (conflict-warning UI is a desktop slice).

**Acceptance:** corrections work without large-model restart. — ☑
`test_glossary.py` hot-reload test.

## Implementation

`services/inference/src/local_squad_inference/glossary.py`:

- `GlossaryEntry(entry_type, source, target, scope, scope_key, note)` with
  types `preserve`, `asr_correction`, `preferred_translation`, `alias`.
- `Glossary.apply()` applies ASR corrections + aliases (left-to-right).
- `preserve_terms()` reports preserve-type placeholders for post-MT restore.
- `preferred_translation()` forces an English output for a source phrase.
- Applicability ordering: global entries first, then source/profile/model.

Tests: `test_glossary.py` (9) — corrections, aliases, preserve, preferred
translation, scoping, hot reload, limits, JSON roundtrip.

## Follow-ups

- Desktop glossary editor UI (scopes, conflict warnings, import/export).
- Wire glossary into the caption pipeline after phrase filters, before
  translation (spec §7 order).
