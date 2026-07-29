# Phase 0 Validation Record

Date: 2026-07-30

## Acceptance Criteria

- A clean clone can install dependencies and run lightweight checks.
- No model is required or downloaded by CI.
- No secrets or user content are committed.
- Node, Rust, and Python workspaces have version and lock files.
- The codebase follows the external-only safety boundary.

## Implemented Slice

- Tauri 2 control-window foundation with a deliberately inactive capture/inference status.
- React UI with strict TypeScript, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes`.
- Rust workspace with `unsafe_op_in_unsafe_fn` denied in every local crate.
- Trait-based audio source boundary and an explicitly bounded inference-frame queue.
- Versioned IPC envelope primitives and fixed message-size limits.
- Caption store with stale-revision and final-terminal failure tests.
- Content-free diagnostics schema.
- Python sidecar health payload with strict runtime validation and no loaded models.
- Frontend, Rust, and Python automated checks plus Windows CI.
- ADR template and ADR-001 through ADR-007.

## Privacy and Safety Evidence

- The desktop reports capture and inference as inactive.
- The sidecar emits only service/version/protocol/health fields.
- Model artifacts and common raw-audio extensions are ignored.
- No network service, audio device access, game process access, hook, driver, input automation, or
  telemetry exists in this phase.

## Target Hardware

User-provided target:

- Windows 11 x64;
- NVIDIA RTX 4070 Ti;
- 32 GB RAM.

The planning documents assume 12 GB VRAM, but the exact GPU variant, VRAM, driver, CPU, and Windows
build must be recorded on the target PC before GPU profile claims are made.

Phase 0 performs no GPU work. Therefore GPU, VRAM, gameplay FPS, and model latency are **not
applicable**, not zero. They become measured gates in Phases 6–9.

## Automated Evidence

Validation host: macOS development host (non-hardware checks only).

- `pnpm format:check`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: passed under strict TypeScript settings.
- `pnpm test`: 2 tests passed.
- `pnpm build`: production frontend build passed; output JavaScript was 194.22 kB
  (61.04 kB gzip).
- `cargo fmt --all --check`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo test --workspace`: 10 tests passed, including bounded-queue, stale-revision,
  terminal-caption, size-limit, and failure-path coverage.
- `uv run ruff check .`: passed.
- `uv run ruff format --check .`: passed.
- `uv run mypy`: passed in strict mode for 6 source files.
- `uv run pytest`: 3 tests passed.
- `uv run python services/inference/app.py`: emitted a content-free health record with
  `models_loaded=false` and exited.
- `pnpm --filter @local-squad-translator/desktop tauri build --no-bundle`: integrated optimized
  desktop build passed on the validation host.

Lock evidence:

- `pnpm-lock.yaml`;
- `Cargo.lock`;
- `uv.lock`;
- `rust-toolchain.toml`;
- root `package.json` pins pnpm 10.32.1.

No model or audio fixture was downloaded during validation.

## Manual Windows Checklist

- [ ] `pnpm --filter desktop tauri dev` opens the control window on Windows 11.
- [ ] Closing the control window terminates the desktop process.
- [ ] The UI states that capture and inference are not running.
- [ ] No Windows microphone, audio endpoint, network, or GPU permission/activity is observed.
- [ ] `uv run python services/inference/app.py` emits one JSON health line and exits.

These items require the target Windows PC and are not inferred from checks on another operating
system.

## Next Gate

Phase 1 was implemented on macOS at the project owner's direction under ADR-008. Windows foundation
and overlay acceptance remain deferred and are not recorded as passing. Audio and models remain out
of scope.
