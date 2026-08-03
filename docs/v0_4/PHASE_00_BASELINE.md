# v0.4 Phase 0 — Freeze Baseline (evidence)

**Status:** ☑ complete

## Tactical error taxonomy

Defined in `services/inference/src/local_squad_inference/evaluation/taxonomy.py`.
Eleven classes (`correct` … `overlap_failure`); the critical set for gameplay
is `wrong_number`, `wrong_site`, `wrong_direction`, `negation_reversed`,
`term_corrupted`, `overlap_failure`.

```text
correct / mostly_correct / wrong_language / wrong_number / wrong_site /
wrong_direction / negation_reversed / term_corrupted / hallucination /
speech_omitted / overlap_failure
```

## Feature flags

- Rust: `caption_trust_enabled()` — env `LST_CAPTION_TRUST`, default enabled
  (mirrors `multi_source_enabled`). Tests cover default, `=0` disable, and the
  `AppStatus.caption_trust` field.
- TS mirror: `apps/desktop/src/sources/captionTrustFlag.ts`
  (`CAPTION_TRUST_ENABLED`).
- Python: taxonomy module is a pure vocabulary; the language gate already
  honors `LST_*` env for region/endpoint; no gate change needed in Phase 0.

## Baseline fixtures

- Callout regression set: `scripts/validation/callout_regression.py` (18 rows,
  numbers / positions / rotate / rush / short commands) — reproducible,
  no models needed. 18/18 passing (see Phase 11 v0.3 evidence).
- Live caption fixture: sidecar `test_v2_live_two_sources...` — reproducible
  two-source roundtrip.

## Baseline latency/resource notes (v0.3, synthetic)

See `docs/v0_3/PHASE_11_EVIDENCE.md` latency table. Real-model latency is a
`[WINDOWS]` hardware row.

## Commands to reproduce

```bash
# taxonomy sanity
.venv/bin/python -m pytest services/inference/tests -q

# callout regression
.venv/bin/python scripts/validation/callout_regression.py
```
