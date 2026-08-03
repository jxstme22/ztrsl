# v0.4 — Caption Accuracy, Overlap Awareness, and Trust

**Primary question:** Can users trust the caption shown on screen?

## Milestone intent

v0.3 delivered multi-source audio, source-aware captions, language profiles,
strictness, and a shared scheduler. v0.4 focuses on the hard cases *inside* a
valid source: overlapping speakers, wrong tactical terms, uncertain output,
phrase noise, glossary corrections, and making Off/Balanced/Strict real.

Source: [`BUILD_PLAN_V0_4_CAPTION_TRUST.md`](../../BUILD_PLAN_V0_4_CAPTION_TRUST.md)

## Phases

| # | Phase | Status | Acceptance |
|---|-------|--------|-----------|
| 0 | Freeze baseline | ☑ | reproducible baseline report exists |
| 1 | Accuracy Lab | ☑ | same clip comparison is reproducible |
| 2 | Language strictness | ☑ | profile selection changes real processing behavior |
| 3 | Phrase filters | ☑ | filtered phrases never reach MT or overlay |
| 4 | Glossary editor | ☑ | corrections work without large-model restart |
| 5 | Certainty states | ☑ | uncertain output is visibly distinct |
| 6 | Overlap detection | ☑ | heavy overlap is not confidently captioned by default |
| 7 | Adaptive scheduler | ☑ | final jobs survive and queues stay bounded |
| 8 | Recommendations + validation | ☑ | release checklist passes |

## Hard boundaries (unchanged)

- No game-process access, memory reads, hooks, input automation, or anti-cheat
  evasion.
- No cloud audio; everything stays local.
- No default transcript/audio persistence.

## Cross-cutting

- Feature flag: `LST_CAPTION_TRUST` (v0.4) — when off, behave exactly like v0.3.
- Every model artifact keeps its checksum + license provenance.
- Certainty, overlap, and filter metadata travel through IPC without leaking
  transcript content.
