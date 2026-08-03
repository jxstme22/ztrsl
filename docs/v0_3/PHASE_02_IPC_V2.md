# Phase 2 — IPC v2

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 2)

1. Audio packets carry a `source_id` in the header; captions carry the source's presentation snapshot (tag + style + color).
2. `source.presentation.update` control updates tag/style/color without touching identity or pipeline state.
3. Strictness/filter fields travel with captions.
4. v1/v2 handshake negotiation works; v1 clients get the single v0.2-style source.
5. Fake sidecar demonstrates two sources producing independent captions.

## Tasks
- [ ] Negotiation: `HelloPayload` gains `ipc_v2` capability; rust + python both speak v1 and v2
- [ ] Audio header v2: append `source_id` (16 bytes) after existing 50-byte v1 header
- [ ] Caption payload v2: `source_snapshot { tag, style, color }`, `strictness`, `filter_applied`
- [ ] Control message `source.presentation.update`
- [ ] Rust `ipc-protocol` crate: v2 encode/decode + round-trip tests
- [ ] Python `protocol.py`: v2 encode/decode + round-trip tests
- [ ] Fake sidecar multi-source mode (TEAM + DISCORD independent caption streams)
- [ ] Migration shim: v1 frames map to legacy single source; reject v1 sources in v2 lanes
- [ ] Freeze compliance pass against `docs/v0_3/IPC_V2_FREEZE.md`

## Files (expected)
- `crates/ipc-protocol/src/lib.rs` (v2 types + codec)
- `services/inference/src/local_squad_inference/protocol.py`
- `apps/desktop/src/ipc/model.ts` (v2 caption schema)
- fake sidecar test fixtures

## Evidence policy
Rust + Python round-trip tests, frontend decode tests, fake-sidecar caption independence test (two sources, rename one, verify no cross-revision effect).
