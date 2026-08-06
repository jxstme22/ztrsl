# Generalization Context

Repository context for the yTSRL generalization program (v0.8 train).
Read this file and `docs/GENERALIZATION_DECISIONS.md` before every task.

## Product goal

Generalize yTSRL from a VALORANT-first translator into a clean, reliable,
general-purpose real-time subtitle and translation application. VALORANT
remains available as a domain preset; game-specific assumptions must not
leak into General Conversation behavior.

## Baseline

| Item | Value |
|---|---|
| Implementation branch | `feat/general-purpose-v0.8` |
| Branch point | `42ae754` (release v0.7.1, pushed to main) |
| Application version | 0.7.1 |
| Protocol | v1 = 1, v2 = 2 (sidecar negotiates the highest both support) |
| Target OS | Windows 11 x64 (primary), macOS Apple Silicon |

## Canonical verification commands (DS-001)

| Area | Focused command | Full command |
|---|---|---|
| Python tests | `pytest services/inference/tests -q` | same (run with `.venv/bin/python -m`) |
| Python typing | `mypy services/inference/src` | `mypy services/inference/src services/inference/tests` |
| Python lint | `ruff check services/inference/src` | `ruff check services/inference/src services/inference/tests` |
| Python format | `ruff format --check services/inference/src` | `ruff format --check services/inference/src services/inference/tests` |
| Rust tests | `cargo test -p <crate>` | `cargo test --workspace` |
| Desktop tests | `pnpm vitest run <file>` (from `apps/desktop`) | `pnpm vitest run` |
| Typecheck | `pnpm typecheck` (from `apps/desktop`) | same |
| Lint | `pnpm lint` (from `apps/desktop`) | same |
| CI (Windows providers) | `gh workflow run smoke-models.yml` | — |
| Packaging | `pnpm tauri build` (from `apps/desktop`) | release.yml workflow |

Baseline run at branch point (all passing):

- pytest: 197 passed, 1 skipped
- mypy: no issues (46 files)
- ruff check: clean · ruff format: clean
- cargo test --workspace: 17 suites ok
- vitest: 213 passed · typecheck: clean · lint: clean

## Current behavior inventory (DS-002)

### Source-profile IDs (desktop `apps/desktop/src/sources/profiles.ts`)

`tagalog`, `taglish`, `cebuano`, `bislish`, `mandarin`, `chinese_english`,
`auto`. Each carries `forcedAsrLanguage` (`tl` / `zh` / `null` for
auto-detect), display label, description, and recommended strictness.

### Profile → ASR source mode (sidecar `sidecar.py::profile_source_mode`)

Only `chinese` maps to the Chinese source mode; every other profile
(including `auto` and `chinese_english`) currently maps to `filipino`.
This is the DS-100/DS-101 defect: unknown/auto profiles silently select an
unrelated language.

### ASR providers (`services/inference/src/local_squad_inference/providers.py`)

`demo`, `SherpaOmnilingualProvider` (omni-ctc), `NemoCtcProvider`
(ncspeech family), `StreamingParaformerProvider`, `SenseVoiceProvider`,
`FasterWhisperProvider`, `MlxWhisperProvider` (macOS), `GroqWhisperProvider`
(HTTP, opt-in).

### Translation providers

`NllbCTranslate2Provider` (default), `MadladTranslationProvider` (candle
runner), `OpusMtProvider` family (`opus-mt-en-zh`, `opus-mt-zh-en`),
`DemoTranslationProvider`, HTTP providers (libretranslate,
google-translate, mymemory, custom-http; opt-in).

### Provisional-caption cadence (`sidecar.py`)

`PROVISIONAL_MIN_SPEECH_NS = 800_000_000` (first provisional after 800 ms
of speech), `PROVISIONAL_CADENCE_NS = 600_000_000` (revisions every 600 ms
while talking).

### Final-caption path

VAD utterance closes on silence/forced end → worker transcribes the whole
utterance (final) → translation → caption with `status=final`, revision
monotonic, upserts into history (finals only).

### Audio queue behavior

Capture callback → bounded `mpsc::sync_channel` (per-endpoint, capacity
passed at capture start) → 16 kHz mono linear resampler → WebSocket frames.
Per-source queues in the sidecar VAD worker are bounded; overload drops are
counted in metrics (`LiveMetrics`), surfaced in Diagnostics.

### VAD defaults (`vad.py::VadConfig`)

frame 30 ms · speech_rms 0.018 · silero_threshold 0.5 ·
min_speech_ms 180 · pre_roll_ms 180 · min_silence_ms 450 ·
max_utterance_ms 12 000. Sensitivity slider 0..100 → `vad_config_from_sensitivity`.

### Model-selection persistence

Live panel persists provider/model choices in `localStorage`
(`lst.live.*` keys: ASR provider, translation provider, source mode,
target language, VAD sensitivity, caption mode, endpoints, monitor state).

### Source persistence

`apps/desktop/src/sources/model.ts` — `sourceConfigsSchema` with
`schemaVersion: 3`, `MAX_SOURCES = 8`. Per source: `sourceId` (32-hex,
immutable), `displayName`, `captionTag`, `labelStyle`, `captionAlignment`,
`color`, `captureTarget` (`endpoint`/`process`), `monitoring`, `languageProfile`, `strictness`.

### Onboarding / setup screens

No setup wizard since v0.6.7. Sources page has per-source cards plus a
VB-CABLE detection card (Windows); Live page has provider/language
controls and Capture mode (One channel / All sources). Home page is the
Live page.

### Multi-source live

`LiveStartRequest.sources` → one live session capturing N endpoints, each
tagged with `source_id`; sidecar VAD/ASR/translation per source; captions
stamped with per-source tag/color/language profile (`source.registry`).

## Completed tasks

- [x] DS-000 — implementation branch created, baseline recorded
- [x] DS-001 — canonical verification commands discovered, baseline run
- [x] DS-002 — behavior inventory recorded
- [x] DS-003 — benchmark fixture schema

## Next task

DS-100 — regression tests for language routing (write failing tests first).

## Decisions that must not be reversed

- Hard safety boundaries (no injection, no memory reads, no automation) —
  see `docs/09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md`.
- No silent fallback to an unrelated language (DEC-001).
- Local-first default workflow.
- Bounded queues; no unbounded buffering in audio/inference paths.
