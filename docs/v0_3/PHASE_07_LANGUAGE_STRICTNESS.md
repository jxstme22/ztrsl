# Phase 7 — Language Profiles and Strictness

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 7)

1. Profiles (`tagalog`, `taglish`, `cebuano`, `bislish`, `mandarin`, `chinese_english`, `auto`) are selectable per source.
2. Strictness Off/Balanced/Strict is per source and demonstrably changes behavior.
3. UI honestly reports forced/preferred/post-filtered capability per provider — never claims decoder locking for post-filter-only providers.
4. Tactical bypass, glossary, and English-skip are per source; language filter metrics exist.

## Implementation

### Profile catalog (`services/inference/src/local_squad_inference/profiles.py`)

Seven profiles per spec §6.2 with `forced_asr_language` (Whisper ISO-639-1 token
or null), `allowed_languages`, `allow_english_terms`, `translation_target` (`en`),
`glossary_ids`, and `recommended_strictness`. `auto` recommends `off`; the rest
recommend `balanced`. Unknown profile ids fall back to `auto` so a stale desktop
registry cannot brick a session. The TS mirror lives in
`apps/desktop/src/sources/profiles.ts` (metadata + capability table).

### Language gate (`apply_language_gate`, pure)

Strictness Off accepts everything (`filter_applied="off"`). Otherwise, per
utterance, in order:

1. Tactical glossary bypass — every token in the text is a whitelisted callout
   (numbers, "rush", "site", "rotate", … under `valorant-core`): always
   `passed` (`reason="tactical_glossary"`), even in Strict with junk confidence.
2. Short-callout protection — under `SHORT_CALLOUT_MS` (350 ms) a caption passes
   (`reason="short_callout"`) unless confidence is catastrophically low.
3. Language mismatch — when a detected language is available and it is not in
   `allowed_languages` (English allowed when `allow_english_terms`), Balanced
   `flagged`, Strict `suppressed` (`reason="language_mismatch"`).
4. Confidence floor — below the per-strictness minimum, Balanced `flagged`,
   Strict `suppressed` (`reason="low_confidence"`).

`English-skip` is the `english_terms` pass: English speech is allowed (and not
flagged) under profiles that set `allow_english_terms`. Translation itself is
not skipped this phase (the pipeline always translates; skipping is an
optimization tracked for Phase 11).

### Wire integration (`sidecar.py`)

`stamp_v2_caption` now runs the gate on every live caption using the registry's
per-source `language_profile` + `strictness`, stamps
`filter_applied`/`filter_reason`/`strictness`, and increments per-source
`_FilterStats`. `suppressed` captions are still sent (the overlay hides them),
per the IPC v2 freeze. Counters surface in `source.diagnostics` under `filter`
({applied, suppressed, flagged, passed, off}). `AsrResult` gained an optional
`language` field (filled from faster-whisper's detected language) so a future
provider can feed real language into the gate; today captions carry no language
signal, so the gate runs confidence/tactical/short-callout checks only — this is
the honest post-filter classification the ADR-016 requires.

### Desktop

`SourcesPanel` per-source cards gained Language profile + Strictness selects
(with descriptions), and a capability-honesty note rendered from
`capabilityNote(asrProvider, profile)`. The capability table classifies CTC
NCSpeech models as `forced`, multilingual decoders (local/whisper/groq) as
`preferred`, demo/unknown as `post-filter`; the default is `post-filter` so the
UI can never overclaim a decoder lock. The live provider is threaded as an
optional prop (default `local`); the full provider catalog wiring is Phase 9.

## Files

- `services/inference/src/local_squad_inference/profiles.py`
- `services/inference/src/local_squad_inference/sidecar.py` (gate stamping, diagnostics)
- `services/inference/src/local_squad_inference/providers.py` (`AsrResult.language`)
- `services/inference/tests/test_profiles.py` (16 tests)
- `services/inference/tests/test_sidecar.py` (v2 live filter-field + diagnostics assertions)
- `apps/desktop/src/sources/profiles.ts`, `profiles.test.ts`
- `apps/desktop/src/components/SourcesPanel.tsx` (profile/strictness/capability UI)

## Evidence

- Gate matrix tests (`test_profiles.py`, 16): off accepts everything; tactical
  bypass wins over Strict; short-callout pass vs catastrophic-confidence flag;
  language mismatch flagged/suppressed by strictness; English-skip when allowed;
  English flagged when not; confidence floor; confidence-only gating without a
  language signal; empty text; unknown profile fallback; strictness
  normalization. All pass.
- Python suite: `109 passed, 1 skipped`; `ruff check` + `ruff format` clean.
- Rust workspace: `70 passed, 3 ignored`; clippy clean (unchanged this phase).
- Desktop: `139 passed`; `pnpm typecheck` + `pnpm lint` clean. Capability-honesty
  tests assert the UI never claims "fixed"/"enforced" for preferred/post-filter
  providers and only states a hard lock for forced CTC providers.

## Remaining / follow-ups

- Thread `AsrResult.language` onto captions so the gate's language-mismatch
  branch runs live (Phase 10/11); provider capability catalog (Phase 9).
- English-skip translation optimization (Phase 11).
