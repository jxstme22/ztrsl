# Phase 3 — Multiple Audio Pipelines

**Status:** ◐ in progress (slice 1 complete: registry + identity + runtimes; Windows-hardware slice pending)

## Acceptance criteria (spec §17 Phase 3)

1. Sources are enumerated and registered from ordinary Windows audio APIs.
2. Endpoint and process-loopback captures run concurrently; failures are isolated per source.
3. Each source has its own buffer, resampler, audio meter, sequence, and monitoring settings.
4. Audio that does not match the source's target is never mixed into that source's ASR path.

## Tasks
- [x] `audio-core` source registry keyed by immutable `source_id` (slice 1: `source.rs`)
- [x] `source_identity.rs`/`capture_target.rs`/`source_runtime.rs`/`source_manager.rs` (slice 1, single `source.rs` module)
- [ ] Process-loopback capture target (loopback on a named process's default device; no hooks) — `windows-hw` acceptance
- [x] Per-source sequence numbering and metrics (slice 1)
- [ ] Per-source monitoring settings (headphone blend only; never into ASR)
- [x] Cross-platform stubs: non-Windows compiles; `CaptureTarget::Process` validates and errors `InvalidCaptureTarget` at runtime until the Windows capture lands
- [x] Unit tests (mocked devices): failure isolation, per-source numbering, no cross-source frames
- [ ] Hardware tests tagged `windows-hw` and CI-skippable
- [ ] Tauri `audio_endpoints` v2 command (sources with targets + endpoints) + `platform_endpoints` extension

## Files (expected)
- `crates/audio-core/src/source_*.rs` → slice 1 delivered as `crates/audio-core/src/source.rs`
- Tauri `audio_endpoints` v2 command (sources with targets + endpoints) — pending
- `platform_endpoints` extension — pending

## Evidence policy
Two simultaneous fake/endpoint sources, one failing — the other keeps producing; no source sees another's frames; metrics per source.

## Slice 1 evidence (registry + identity + runtimes)
- `cargo test -p audio-core`: 21 passed (7 new: id hex round-trip, malformed rejection, v4 shape, target serde/validation, per-source sequencing + resampling, failure isolation, cross-source frame separation, unregister).
- `cargo test --workspace`: 66 passed, 3 ignored; `cargo clippy --all-targets`: 0 warnings; `cargo fmt --check`: clean.
- Isolation proof: failing capture returns `EndpointInvalidated` for its own id while the healthy source keeps emitting frames with its own `source_id`.
- Wire alignment: `CaptureTarget` serde matches IPC v2 freeze §4.2 (`{"kind":"endpoint","endpoint_id":…}` / `{"kind":"process","process_name":…}`).
- Remaining: process-loopback capture + desktop wiring are Windows-hardware acceptance (tagged `windows-hw`, CI-skippable).
