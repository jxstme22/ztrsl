# v0.4 Phase 8 — Recommendations and Validation

**Status:** ☑ complete (recommendation core + tests; validation doc = this file
series)

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 8)

1. Hardware compatibility — ☑ `hardware_class()` (cpu / gpu-low / gpu-medium /
   gpu-high).
2. Benchmark-informed suggestions — ☑ `accuracy_winner_asr` input is credited
   in the rationale.
3. Real-session matrix — the hardware matrix is tracked in
   `docs/v0_3/PHASE_11_EVIDENCE.md` `[WINDOWS]` rows; this phase's core is the
   explainable recommendation logic.
4. v0.4 validation document — ☑ these phase docs + the release checklist.

**Acceptance:** release checklist passes. — ☑ (`docs/v0_4/` all checked; the
v0.3 hardware rows remain `[WINDOWS]`).

## Implementation

`services/inference/src/local_squad_inference/evaluation/recommendations.py`:

- `Recommendation(asr_provider, translation_provider, rationale, differs_from_default)`.
- `recommend()` combines profile/strictness/hardware/resource policy/installed
  runtimes/accuracy winner:
  - strict Tagalog-family -> fixed-language NCSpeech CTC;
  - Mandarin -> Citrinet CTC;
  - else Whisper Turbo (or the Accuracy Lab winner, credited);
  - maximum_accuracy + capable GPU -> MADLAD, else NLLB;
  - uninstalled recommended runtimes are flagged honestly.
- Suggestions are optional and explainable — never auto-install/switch.

Tests: `test_recommendations.py` (8) — hardware class, strict/mandarin choices,
balanced defaults, maximum-accuracy GPU vs CPU, accuracy-winner credit,
uninstalled honesty.

## v0.4 validation summary

- Phase 0 baseline: reproducible fixtures + taxonomy + flags.
- Phase 1 Accuracy Lab: `clip.compare` content-free reproducible reports.
- Phase 2 strictness: delivered in v0.3, verified.
- Phase 3 phrase filters: 10 tests.
- Phase 4 glossary: 9 tests.
- Phase 5 certainty: IPC + overlay distinct rendering (7 + Rust + desktop tests).
- Phase 6 overlap: 11 tests.
- Phase 7 adaptive scheduler: 5 new tests.
- Phase 8 recommendations: 8 tests.

Hardware-dependent rows remain `[WINDOWS]` in `docs/v0_3/PHASE_11_EVIDENCE.md`.
