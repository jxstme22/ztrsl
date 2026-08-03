# Phase 5 — Per-Source VAD

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 5)

1. VAD runs per source; utterance state (start/end, last speech time, sentence buffers) is keyed by immutable `source_id`.
2. Two sources speaking simultaneously produce independent utterances.
3. Renaming a source or changing its tag does not interrupt or flush its utterance.

## Tasks
- [ ] Sidecar: per-source VAD sessions and utterance state maps (no global state)
- [ ] Per-source start/stop/flush controls
- [ ] Utterance lifecycle events carry `source_id`
- [ ] Per-source VAD diagnostics counters
- [ ] Tests: interleaved speech on two sources, tag-edit-during-utterance, flush behavior

## Files (expected)
- `services/inference/src/local_squad_inference/live.py` (state keyed by source)
- `services/inference/src/local_squad_inference/vad.py` (session-per-source)
- `services/inference/src/local_squad_inference/sources/` per spec §18

## Evidence policy
Fake-sidecar test: two sources with alternating and overlapping speech → independent utterances with correct source attribution before and after a rename.
