# v0.4 Phase 2 — Language Strictness

**Status:** ☑ complete (delivered in v0.3 Phase 7; verified against v0.4 spec)

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 2)

1. Off/Balanced/Strict — ☑ `profiles.py` gate, exercised by `test_profiles.py`.
2. Forced language where supported — ☑ `forced_asr_language` per profile +
   capability honesty (forced only for fixed-language CTC models).
3. Language gate — ☑ `apply_language_gate`.
4. Tactical short-term bypass — ☑ tactical glossary (expanded in v0.4 Phase 11
   v0.3 evidence: multi-word callouts pass under Strict).
5. Provider limitations UI — ☑ Models panel capability labels
   (forced/preferred/post-filter), never claims decoder locking.

**Acceptance:** profile selection changes real processing behavior. — ☑
`test_profiles.py` 16-case matrix + `scripts/validation/callout_regression.py`.

## Notes

No new v0.4 code was required: the v0.3 language-gate delivery already meets
this phase's acceptance. The per-source `allowed_languages`/`allow_tactical_terms`
fields are expressed through the profile catalog (`allowed_languages`,
`allow_english_terms`, `glossary_ids`).
