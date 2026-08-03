# Phase 7 — Language Profiles and Strictness

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 7)

1. Profiles (`tagalog`, `taglish`, `cebuano`, `bislish`, `mandarin`, `chinese_english`, `auto`) are selectable per source.
2. Strictness Off/Balanced/Strict is per source and demonstrably changes behavior.
3. UI honestly reports forced/preferred/post-filtered capability per provider — never claims decoder locking for post-filter-only providers.
4. Tactical bypass, glossary, and English-skip are per source; language filter metrics exist.

## Tasks
- [ ] Profile catalog in sidecar (`profiles/`) + TS mirror
- [ ] Strictness modes: Off (accept everything), Balanced (filter low-confidence mismatches), Strict (forced provider where supported / honest post-filter elsewhere)
- [ ] Language gate: caption suppressed vs flagged vs translated per strictness
- [ ] Tactical bypass (e.g. numbers/status words allowed in English)
- [ ] Per-source glossary list
- [ ] English-skip option
- [ ] Filter decision counters for Phase 10
- [ ] Tests: strictness matrix per profile/provider; UI capability honesty test

## Files (expected)
- `services/inference/src/local_squad_inference/profiles/*`
- `apps/desktop/src/sources/profiles.ts` + settings UI
- IPC v2 strictness fields (freeze doc)

## Evidence policy
Matrix test: for each profile × provider × strictness, expected behavior asserted; UI text verified against provider capability list.
