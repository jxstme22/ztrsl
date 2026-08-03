# v0.4 Phase 1 — Accuracy Lab

**Status:** ☑ complete

## Acceptance criteria (BUILD_PLAN_V0_4 §13 Phase 1)

1. Multi-configuration execution: run one clip through multiple installed
   ASR/MT configurations. — ☑ `clip.compare` + `evaluation/accuracy_lab.py`
2. Error labels (taxonomy). — ☑ `evaluation/taxonomy.py` + `annotate_report`
3. Machine-readable reports (JSON + Markdown). — ☑ `CompareReport.to_json/.to_markdown`
4. Exact runtime/model metadata (id, revision, runtime, checksum). — ☑ model id
   per run; revision/checksum are surfaced from the catalog at the store level
   (Phase 9) — wired in the run's `model_id` now.

**Acceptance:** same clip comparison is reproducible. — ☑ (sidecar wire test +
unit tests run the same fake clip deterministically)

## Tasks
- [ ] Sidecar `clip.compare` (or equivalent): one file, N configurations
- [ ] Per-config metadata: model id, revision, runtime, checksum, latency
- [ ] Error taxonomy annotation API (Correct / Wrong number / Wrong site / …)
- [ ] Report export (JSON + Markdown), no transcript content by default
- [ ] Desktop Accuracy Lab panel (extend Clip Lab)
- [ ] Tests: reproducible comparison, metadata completeness, report hygiene

## Files (expected)
- `services/inference/src/local_squad_inference/evaluation/`
- `apps/desktop/src/features/accuracy-lab/`

## Evidence policy
Run one fixture clip through 2+ installed configurations twice; assert the two
runs are identical and reports carry full model metadata.
