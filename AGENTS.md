# AGENTS.md — Instructions for Codex

## Mission

Build a local Windows accessibility companion that translates incoming VALORANT voice chat from Tagalog/Cebuano into English subtitles. Optimize for safety, privacy, measured accuracy, and low disruption to gameplay.

## Authority Order

When instructions conflict, follow this order:

1. `docs/09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md`
2. `docs/01_PRD.md`
3. `docs/15_ACCEPTANCE_CHECKLIST.md`
4. `docs/02_SYSTEM_ARCHITECTURE.md`
5. `docs/07_BUILD_PLAN.md`
6. Remaining documents

Do not silently reinterpret a MUST requirement. Record justified deviations in an Architecture Decision Record.

## Hard Safety Boundaries

Never implement:

- game-process injection;
- graphics API hooks;
- process memory reads;
- game-file modification;
- packet interception;
- input automation;
- anti-cheat evasion;
- kernel drivers;
- hidden-data extraction;
- screen analysis used for tactical advantage.

The application may only:

- enumerate and use ordinary Windows audio endpoints;
- process local audio;
- expose settings and diagnostics;
- draw an ordinary top-level transparent window;
- register explicit global hotkeys;
- store user-approved local settings and optional history.

## Engineering Rules

- Target Windows 11 x64 first.
- Use stable Rust and Tauri 2.
- Use TypeScript strict mode.
- Prefer bounded channels, ring buffers, and explicit backpressure.
- No unbounded queues in audio or inference paths.
- No blocking I/O on the audio callback.
- No GPU work on the UI thread.
- No secrets committed to the repository.
- No telemetry without explicit opt-in.
- No raw audio persistence unless the user enables diagnostic recording.
- Redact usernames and paths from logs where reasonable.
- Every background process must have deterministic shutdown.
- Every model artifact must have a checksum and documented license/source.
- Pin critical dependencies after the first working milestone.

## Local Setup (Windows)

One-time, from the workspace root:

1. `uv sync --extra dev --extra models` — installs `faster-whisper`, `ctranslate2`,
   `onnxruntime`, `sherpa-onnx`, etc. into `.venv`. Without `--extra models`, live
   local ASR fails with "faster-whisper and CTranslate2 are required for quality
   local ASR".
2. `python scripts/install_models.py whisper-turbo --accept-license` (or
   `whisper` for the full large-v3 model),
   `python scripts/install_models.py nllb --accept-license` (near-real-time
   translation, CC-BY-NC-4.0; runs on CUDA when available, CPU fallback), and
   optionally `python scripts/install_models.py madlad --accept-license` —
   downloads the verified model artifacts into `models/artifacts/`. The live
   sidecar prefers `whisper-large-v3-turbo` (lighter, ~1.6 GB) and falls back
   to `whisper-large-v3` (~3.1 GB) when only that is installed. Override with
   the `LST_WHISPER_MODEL_ID` environment variable. Translation defaults to
   `nllb` (`nllb-200-distilled-600M-ct2-int8`, ~600 MB, tens of ms on CUDA,
   ~340 ms/sentence on CPU); `madlad` (MADLAD-400-3B via the Rust
   candle runner, ~50 s per caption on CPU) remains selectable.
3. Optional NVIDIA CTC ASR exports: `scripts/export_ncspeech_onnx.py` performs a
   one-time NeMo→CTC ONNX export into `models/artifacts/` and writes a verified
   manifest. It requires a build venv with `nemo_toolkit[asr]` and `torch`
   (~2-3 GB extra disk); the runtime inference venv only needs `sherpa-onnx`.
   Without the export the matching provider raises a visible start error.
   Variants: `--variant tl` (default; NCSpeech FastConformer Tagalog,
   `ncspeech` provider) and `--variant zh` (Citrinet-1024 Mandarin from
   `nvidia/stt_zh_citrinet_1024_gamma_0_25`, AISHELL-2 character vocab,
   `ncspeech-zh` provider, ~555 MB archive) and `--variant zh-parakeet`
   (Parakeet-CTC 0.6B Mandarin from `nvidia/parakeet-ctc-0.6b-zh-cn`,
   gated repo — run `huggingface-cli login` first; 17k hours zh-CN,
   `ncspeech-zh-parakeet` provider, ~2.5 GB archive). All are CC-BY-4.0.
   SenseVoice Small (zh/en/ja/ko/yue, `sensevoice-small` provider) is a normal
   catalog model installed from the Models page — no export step needed; the
   sidecar runs it via `sherpa_onnx.OfflineRecognizer.from_sense_voice`
   against the pinned `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`
   export (Apache-2.0, FunASR MODEL_LICENSE).
4. The `translation-runner` Rust binary is rebuilt automatically by the Tauri
   `beforeDev`/`beforeBuild` hooks via `scripts/ensure-translation-runner.mjs`.
   After a manual `cargo clean`, the first `pnpm tauri dev`/`pnpm tauri build`
   will relink it; no manual step is needed.

Run the app from `apps/desktop`:

- `pnpm tauri dev` — Vite + Tauri dev window.
- `pnpm tauri build` — packaged installer under
  `apps/desktop/src-tauri/target/release/bundle/`.

Sanity checks:

- `cargo test -p audio-core`, `cargo test -p sidecar-supervisor`
- `pnpm test`, `pnpm typecheck`, `pnpm lint` (run from `apps/desktop`)

## Work Method

For every phase:

1. Restate the phase acceptance criteria in the implementation PR description.
2. Implement the smallest vertical slice.
3. Add automated tests.
4. Add diagnostics before optimization.
5. Run all relevant checks.
6. Update documentation.
7. Record observed latency, CPU, GPU, and VRAM.
8. Stop if a hard safety boundary would be crossed.

## Code Quality

### Rust

- `#![deny(unsafe_op_in_unsafe_fn)]`
- Keep unsafe Windows interop isolated and documented.
- Prefer `thiserror` for domain errors and `anyhow` only at application boundaries.
- Use `tracing` with structured events.
- Avoid panics in production paths.
- Audio callbacks must not allocate where avoidable.
- Expose trait-based boundaries for device capture and playback so they can be mocked.

### TypeScript

- Enable `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Validate IPC messages at runtime.
- UI state must distinguish provisional and final captions.
- Never render unsanitized HTML from transcripts.

### Python

- Python 3.11 or later.
- Type checking with mypy or pyright.
- Formatting/linting with Ruff.
- Pydantic models for IPC payloads.
- Bound inference queues.
- Load models once per process.
- Make model providers replaceable behind interfaces.
- Tests must run without downloading large models by using fakes.

## Testing Requirements

Every merged phase must include:

- unit tests;
- failure-path tests;
- a manual validation checklist;
- diagnostics or benchmark output;
- documentation updates.

Hardware-dependent tests must be tagged and skippable in CI.

## Commit Strategy

Prefer small, phase-scoped commits:

```text
feat(audio): enumerate Windows endpoints
feat(audio): capture selected loopback endpoint
feat(overlay): add click-through caption window
feat(ipc): define versioned local protocol
feat(vad): segment incoming speech
feat(asr): integrate omnilingual CTC adapter
feat(mt): integrate MADLAD adapter
test(e2e): add recorded voice fixture pipeline
```

Do not mix dependency upgrades, formatting sweeps, and feature work in one commit.

## Required Architecture Decision Records

Create ADRs for at least:

- ADR-001: virtual audio cable versus process loopback;
- ADR-002: Python sidecar versus native inference;
- ADR-003: provisional/final caption lifecycle;
- ADR-004: model download and verification;
- ADR-005: overlay window implementation;
- ADR-006: GPU resource governance;
- ADR-007: data retention defaults.

## Never Claim Completion Without Evidence

A phase is complete only after its acceptance criteria are demonstrated with logs, test output, screenshots where relevant, and benchmark results. Do not substitute “compiles” for “works.”
