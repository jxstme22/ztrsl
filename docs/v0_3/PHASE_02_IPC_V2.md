# Phase 2 — IPC v2

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 2)

1. Audio packets carry a `source_id` in the header; captions carry the source's presentation snapshot (tag + style + color).
2. `source.presentation.update` control updates tag/style/color without touching identity or pipeline state.
3. Strictness/filter fields travel with captions.
4. v1/v2 handshake negotiation works; v1 clients get the single v0.2-style source.
5. Fake sidecar demonstrates two sources producing independent captions.

## Tasks
- [x] Negotiation: `HelloPayload` gains `ipc_v2` capability; rust + python both speak v1 and v2
- [x] Audio header v2: append `source_id` (16 bytes) after existing 50-byte v1 header
- [x] Caption payload v2: `source_snapshot { tag, style, color }`, `strictness`, `filter_applied`
- [x] Control message `source.presentation.update` (+ `source.registry` push at start)
- [x] Rust `ipc-protocol` crate: v2 encode/decode + round-trip tests
- [x] Python `protocol.py`: v2 encode/decode + round-trip tests
- [x] Fake sidecar multi-source mode (TEAM + DISCORD independent caption streams)
- [x] Migration shim: v1 frames map to legacy single source; v1-shaped frames in a v2 session are rejected with `error.protocol_mismatch`
- [x] Freeze compliance pass against `docs/v0_3/IPC_V2_FREEZE.md`

## What shipped

- **Rust `ipc-protocol`**: `PROTOCOL_V2`, 66-byte v2 audio header (`AudioPacketV2`, `source_id` at offset 50), caption v2 fields (`source_id`, `source_snapshot`, `strictness`, `filter_applied`, `filter_reason` — serde `default` + `skip_serializing_if` so v1 JSON is byte-identical), `CaptionLabelStyle`/`CaptionStrictness`/`FilterApplied` enums, `SourceSnapshot`, `SourceRegistryPayload`/`SourcePresentationUpdatePayload` controls, `negotiate_protocol_version`, `source_id_from_hex/to_hex`, `ProtocolError::InvalidSourceId`. 16 tests.
- **Python `protocol.py`**: same wire types as pydantic strict models, `AudioPacketV2` + `parse/encode_audio_packet_v2`, `dump_caption(include_v2=)` that strips v2 keys for v1 sessions, `negotiate_protocol_version`, hex source-id helpers. 14 new tests (round-trips, v1↔v2 cross-rejection, header version bytes, hex validation, v2 caption parse, unknown label-style rejection).
- **Python `sidecar.py`**: negotiates per session (`hello.accepted.protocol_version` = negotiated); v2 binary lane parses v2 frames and rejects v1-shaped frames with `error.protocol_mismatch` + close 1008; `source.registry` / `source.presentation.update` controls (unknown source → `source.presentation.error {code: unknown_source}`); `fake_captions_v2` stamps registry snapshot + strictness; every outbound envelope carries the negotiated version; live captions go through `dump_caption` (v1 sessions stay byte-identical to v0.2). Dead duplicate fake-caption block removed.
- **Rust `sidecar-supervisor`**: proposes `[2,1]` with `ipc_v2` + `multi_source` capabilities, trusts the sidecar's echoed version; all outbound envelopes + audio frames use the negotiated version; `push_source_registry`, `update_source_presentation`, `fake_roundtrip_multi_source` (TEAM+DISCORD rounds, mid-session DISCORD rename → TEAM untouched); new spawn test `v2_multi_source_fake_roundtrip_proves_independent_streams` (skips when the workspace venv is absent).
- **TS**: `model.ts` accepts envelope versions 1 and 2, v2 caption fields with zod validation (source id regex, label style enum); `bridge.ts` exposes `runFakeMultiSourceInference`.
- **Desktop**: `fake_multi_source_roundtrip` Tauri command; `LiveWorkerEvent::Caption` boxed (large_enum_variant); `AppStatus.multi_source` unchanged from Phase 0.

## Evidence

| Check | Result |
|---|---|
| `cargo test -p ipc-protocol` | 16 passed |
| `cargo test -p sidecar-supervisor --lib` | 5 passed (incl. live multi-source spawn test against the real Python sidecar) |
| `cargo test --workspace` | 58 passed, 3 ignored (env-tagged) |
| `cargo clippy --all-targets` | 0 warnings |
| `cargo fmt --check` | clean |
| `uv run pytest tests/` | 76 passed, 1 skipped |
| `uv run ruff check src tests` / `ruff format --check` | clean |
| `uv run mypy src` | 0 issues |
| `pnpm test` | 105 passed / 19 files |
| `pnpm typecheck` / `pnpm lint` | clean |
| `pnpm build` | ok (dist 374 KB js) |
| Freeze §6 proof (Rust spawn test, TEAM+DISCORD, rename mid-session) | TEAM `source_id`/revision unchanged; DISCORD snapshot updates to `DC2`; per-source caption ids never collide |

## Compliance notes (freeze §5, §6)

- v1 wire format unchanged: v1 session paths still emit 50-byte headers and captions without v2 keys (`dump_caption(include_v2=False)`), verified by the pre-existing v1 tests.
- A v2 session receiving a v1-shaped frame gets `error.protocol_mismatch` then close 1008 (sidecar), covered by `test_v2_session_rejects_v1_frames_with_protocol_mismatch`.
- Renaming DISCORD mid-session updates only the stamped snapshot; identity and revision sequence are untouched (Rust + Python tests).
- v2 live sessions with real providers keep per-source caption fields absent until Phases 5/6 (fields optional; envelope version + v2 audio frames are already correct).

## Files (changed)
- `crates/ipc-protocol/src/lib.rs`, `crates/ipc-protocol/Cargo.toml` (serde_json dep)
- `crates/sidecar-supervisor/src/lib.rs`
- `services/inference/src/local_squad_inference/protocol.py`, `sidecar.py`
- `services/inference/tests/test_protocol.py`, `tests/test_sidecar.py`
- `apps/desktop/src/ipc/model.ts`, `model.test.ts`, `bridge.ts`
- `apps/desktop/src-tauri/src/lib.rs`
