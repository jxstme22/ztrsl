# Phase 3 — Multiple Audio Pipelines

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 3)

1. Sources are enumerated and registered from ordinary Windows audio APIs.
2. Endpoint and process-loopback captures run concurrently; failures are isolated per source.
3. Each source has its own buffer, resampler, audio meter, sequence, and monitoring settings.
4. Audio that does not match the source's target is never mixed into that source's ASR path.

## Tasks
- [ ] `audio-core` source registry keyed by immutable `source_id`
- [ ] `source_manager.rs`, `source_runtime.rs`, `source_identity.rs`, `capture_target.rs`
- [ ] Process-loopback capture target (loopback on a named process's default device; no hooks)
- [ ] Per-source sequence numbering and metrics
- [ ] Per-source monitoring settings (headphone blend only; never into ASR)
- [ ] Cross-platform stubs: non-Windows compile with clear unsupported behavior
- [ ] Unit tests (mocked devices), hardware tests tagged `windows-hw` and CI-skippable

## Files (expected)
- `crates/audio-core/src/source_*.rs`
- Tauri `audio_endpoints` v2 command (sources with targets + endpoints)
- `platform_endpoints` extension

## Evidence policy
Two simultaneous fake/endpoint sources, one failing — the other keeps producing; no source sees another's frames; metrics per source.
