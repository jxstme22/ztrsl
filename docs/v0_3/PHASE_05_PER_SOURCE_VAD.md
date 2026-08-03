# Phase 5 — Per-Source VAD

**Status:** ☑ complete (see evidence below)

## Acceptance criteria (spec §17 Phase 5)

1. VAD runs per source; utterance state (start/end, last speech time, sentence buffers) is keyed by immutable `source_id`.
2. Two sources speaking simultaneously produce independent utterances.
3. Renaming a source or changing its tag does not interrupt or flush its utterance.

## Implementation

- `vad.py`: `AudioUtterance` carries `source_id`; `EnergyUtteranceManager(namespace=...)`
  namespaces utterance ids as `{source_hex}-clip-utterance-{n}` (v1 legacy ids unchanged);
  one shared ONNX Silero session per process (`shared_silero_session()`), per-source
  detectors share it while keeping their own recurrent state.
- `live.py`: `LivePipeline` holds `_SourceVadState` per immutable source id
  (per-state clock origins, packet/utterance/caption/drop counters, provisional
  revisions). `start_source` is idempotent — registry re-pushes and
  `source.presentation.update` renames never reset an in-flight utterance.
  `stop_source` flushes only that source and tombstones its state so queued
  utterances still resolve; `flush_source` flushes without dropping state;
  unknown/stopped sources raise on feed; `diagnostics_for`/`metrics_for` read
  tombstones (`active: false`).
- `sidecar.py`: v2 live audio is now routed through the worker (was rejected with
  `1008 "v2 live not supported"`), lazily starting per-source VAD state keyed by
  the immutable id; `profile_source_mode()` maps registry language profile →
  ASR mode (only `chinese` → `chinese`, everything else → `filipino`);
  per-source provisional cadence; controls `source.flush` / `source.stop` /
  `source.diagnostics.request` execute on the VAD thread via a control queue
  (polled while idle, so controls are honored without pending audio);
  captions are stamped with the registry snapshot + strictness via
  `stamp_v2_caption` (frozen `CaptionPayload` → `model_copy`).
- `ipc-protocol`: `SourceControlPayload` added; `sidecar-supervisor` gains
  `send_live_audio_for_source`, `flush_source`, `stop_source`,
  `source_diagnostics`.

## Tasks

- [x] Sidecar: per-source VAD sessions and utterance state maps (no global state)
- [x] Per-source start/stop/flush controls
- [x] Utterance lifecycle events carry `source_id`
- [x] Per-source VAD diagnostics counters
- [x] Tests: interleaved speech on two sources, tag-edit-during-utterance, flush behavior

## Verification commands

```bash
.venv/bin/python -m pytest services/inference/tests -q        # 83 passed, 1 skipped
.venv/bin/python -m ruff check services/inference/            # clean
.venv/bin/python -m ruff format services/inference/           # clean
cargo test --workspace                                        # 70 passed, 3 ignored
cargo clippy --workspace --all-targets                        # clean
pnpm test                                                     # 128 passed (apps/desktop)
pnpm typecheck && pnpm lint                                   # clean
```

## Evidence

- `test_live.py` (unit, fake sidecar):
  - `test_two_sources_keep_independent_utterance_state` — interleaved TEAM/DISCORD
    speech yields independent finals with distinct ids and correct `source_id`.
  - `test_start_source_is_idempotent_and_presentation_edit_does_not_reset_vad`.
  - `test_stop_source_flushes_only_that_source` — stop flushes one source only;
    further packets raise; restart starts a fresh state with new clock origin.
  - `test_flush_source_keeps_vad_state_and_continues_sequence`.
  - `test_unknown_source_packets_raise_and_controls_are_noops`.
  - `test_per_source_metrics_and_diagnostics`.
- `test_sidecar.py` (wire, fake sidecar):
  - `test_v2_live_two_sources_keep_independent_utterances_and_rename_does_not_split` —
    acceptance criterion: simultaneous speech → independent utterances; mid-utterance
    rename → final carries the renamed tag (`TM2`) without splitting or resetting;
    `source.diagnostics.request` returns per-source counters; `source.stop` acks
    per source and DISCORD keeps producing captions.
- `sidecar-supervisor` (wire, real Python sidecar):
  - `v2_live_per_source_vad_lifecycle_over_the_wire` — 6-pass suite over the
    real IPC: interleaved speech produces 2 independent finals with correct
    source ids; `source.stop` acks with metrics; `source.diagnostics.request`
    reports TEAM `active: false` / DISCORD `active: true`.

## Debugging notes

- `_run_vad` originally blocked on `input.get()` and drained controls only at the
  top of the loop, so `source.stop`/`source.flush` deadlocked when no audio was
  pending; now the VAD thread polls with a 50 ms idle timeout and drains controls.
- `stamp_v2_caption` originally mutated the frozen `CaptionPayload`, raising
  `frozen_instance` inside the drain task and silently killing caption delivery;
  it now returns a `model_copy`.

## Files

- `services/inference/src/local_squad_inference/vad.py`
- `services/inference/src/local_squad_inference/live.py`
- `services/inference/src/local_squad_inference/sidecar.py`
- `services/inference/src/local_squad_inference/protocol.py`
- `services/inference/tests/test_live.py`, `services/inference/tests/test_sidecar.py`
- `crates/ipc-protocol/src/lib.rs`, `crates/sidecar-supervisor/src/lib.rs`
