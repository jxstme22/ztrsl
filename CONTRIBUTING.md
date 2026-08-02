# Contributing to xTRSNLTR

Thanks for your interest. This project translates game voice chat locally, so
it carries **hard safety boundaries**. Please read them before contributing.

## Code of conduct

Everyone interacting with this project — code, issues, PRs, or docs — agrees to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Hard safety boundaries (non-negotiable)

Contributions must **never** implement:

- game-process injection, DLL hooks, or graphics API hooks;
- reading game process memory or modifying game files;
- packet interception or input automation;
- anti-cheat evasion, kernel drivers, or hidden-data extraction;
- screen analysis used for tactical advantage.

The application may only: enumerate ordinary Windows audio endpoints; process
local audio; draw an ordinary top-level transparent window; register explicit
global hotkeys; and store user-approved local settings. A change that crosses
these boundaries will be rejected regardless of its quality.

## Before you start

1. Read [AGENTS.md](AGENTS.md) and the project docs in `docs/` (start with
   `00_EXECUTIVE_SUMMARY.md`, `01_PRD.md`, and `15_ACCEPTANCE_CHECKLIST.md`).
2. Check open issues/PRs to avoid duplicating work.
3. For larger changes, open an issue or discussion first to agree on the
   approach.

## Development setup

See the [README](README.md#getting-started-developers) for prerequisites, then:

```powershell
pnpm install --frozen-lockfile
uv sync --extra dev --extra models
```

## Engineering rules

- **Rust**: `#![deny(unsafe_op_in_unsafe_fn)]`; isolate and document unsafe
  Windows interop; `thiserror` for domain errors, `anyhow` only at
  application boundaries; `tracing` for structured logs; no panics in
  production paths; no allocation in audio callbacks where avoidable.
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; validate IPC messages at runtime; never render
  unsanitized HTML from transcripts.
- **Python**: 3.11+; type-check with mypy/pyright; lint/format with Ruff;
  Pydantic models for IPC payloads; bound every inference queue; load models
  once per process; providers behind replaceable interfaces; tests never
  download large models (use fakes).
- **Backpressure everywhere**: bounded channels/ring buffers; no unbounded
  queues in audio or inference paths; no blocking I/O on the audio callback;
  no GPU work on the UI thread.
- **No secrets**: never commit API keys/tokens; no telemetry without opt-in;
  no raw audio persistence unless diagnostic recording is enabled; redact
  usernames/paths from logs.
- **Model artifacts**: every artifact needs a checksum and documented
  license/source; nothing downloads until the user confirms.

## Work method

For every phase/feature:

1. Restate the acceptance criteria in the PR description.
2. Implement the smallest vertical slice.
3. Add automated tests (unit + failure-path + a manual validation checklist).
4. Add diagnostics before optimization.
5. Run all relevant checks (below).
6. Update documentation.
7. Record observed latency, CPU, GPU, and VRAM where relevant.

## Checks

Run these before opening a PR:

```powershell
# Rust
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend (from apps/desktop)
pnpm test
pnpm typecheck
pnpm lint

# Python
.venv\Scripts\python -m pytest services\inference\tests -q
.venv\Scripts\python -m ruff check services\inference tests
.venv\Scripts\python -m mypy services\inference  # if configured
```

Hardware-dependent tests must be tagged and skippable in CI. Do not substitute
"compiles" for "works" — if your change has a visible effect, show evidence.

## Adding a model to the catalog

1. Source a model from an official or vetted URL with a recorded license.
2. Download it, compute the SHA-256 of every artifact, and record sizes.
3. Add a committed manifest under `models/manifests/` (see
   `models/README.md` for the schema).
4. Add a catalog entry to `models/catalog.json` (embedded in the binary) with
   the pinned source, revision, per-file checksums, and download size. Keep
   `download_size_bytes` equal to the sum of the files.
5. `cargo test -p model-manager` must still pass (the catalog is validated at
   load time).
6. Mention the license prominently for the confirmation dialog.

## Commit style

Small, phase-scoped, conventional commits:

```text
feat(audio): enumerate Windows endpoints
feat(overlay): add click-through caption window
feat(ipc): define versioned local protocol
feat(vad): segment incoming speech
feat(asr): integrate Whisper adapter
feat(mt): integrate NLLB adapter
feat(models): add in-app model manager with confirmation dialog
fix(sidecar): cap caption length so long ASR output cannot kill a session
```

Do not mix dependency upgrades, formatting sweeps, and feature work in one
commit.

## Reviewing

Prefer small PRs (a review should take minutes, not hours). When reviewing,
check for safety-boundary compliance first, then correctness, then tests, then
docs. Never merge a PR that adds an unverified model or a secret.

## Reporting vulnerabilities

Do **not** open a public issue for a security problem. See
[SECURITY.md](SECURITY.md) for the private reporting path.
