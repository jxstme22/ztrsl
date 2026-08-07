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

One explicit table `PROFILE_SOURCE_MODES` (DS-101):
`mandarin`/`chinese` → `chinese`; `chinese_english` → `mixed`;
`tagalog`/`taglish`/`cebuano`/`bislish` → `filipino`;
`english`/`indonesian`/`vietnamese`/`thai`/`malay` → their own mode;
`auto` and unknown profiles → `None` (unconstrained, never Filipino — DEC-001).

## Completed tasks

- [x] DS-000 — implementation branch created, baseline recorded
- [x] DS-001 — canonical verification commands discovered, baseline run
- [x] DS-002 — behavior inventory recorded
- [x] DS-003 — benchmark fixture schema
- [x] DS-100 — language-routing regression tests (11 tests, failing first)
- [x] DS-101 — explicit profile→source-mode table (no silent Filipino fallback)

## Next task

DS-102 — tests for Whisper segment filtering (joint no-speech decision).

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
- [x] DS-100 — language-routing regression tests (11 tests, failing first)
- [x] DS-101 — explicit profile→source-mode table (no silent Filipino fallback)
- [x] DS-102 — joint no-speech segment-filter tests (confident speech kept)
- [x] DS-103 — joint no-speech decision (`no_speech_prob` AND poor logprob)
- [x] DS-104 — worker queue instrumentation (submitted/consumed/dropped/max
  depth + provisional/final job drops), exposed via `scheduler.metrics`
- [x] DS-105 — overload shed: provisionals suppressed at queue high-water
  before raw audio eviction; raw drops counted; finals never suppressed
- [x] DS-200 — `sourceOrigin` enum (desktop schema v4, sidecar protocol,
  Rust registry entry; default `virtual_voice_channel`)
- [x] DS-201 — `LanguageConfig` (fixed/primary_preferred/limited_auto/
  full_auto) with validation + profile adapter, crossing desktop ↔ IPC
- [x] DS-202 — data-only domain preset catalog (8 presets, zod-validated)
- [x] DS-203 — quality profiles (fast/balanced/best_quality/low_memory)
  with persisted selection
- [x] DS-204 — source settings v3→v4 migration (adds sourceOrigin +
  languageConfig, preserves everything, idempotent)
- [x] DS-300 — per-source audio health metrics (RMS/peak/clipping/zero/
  non-finite/speech ratio/packets), computed in the VAD feed, surfaced in
  per-source diagnostics
- [x] DS-301 — deterministic source-health states (ready/silent/
  very_quiet/clipping/format_error/overloaded/disconnected/
  monitoring_loop_suspected) with explanation + recommended action
- [x] DS-302 — conservative normalization (bounded gain, cap, never
  touches non-finite/loud, records whether applied)
- [x] DS-303 — source-origin processing policies (virtual channel off,
  microphone light normalize, system mix strict validation, recorded file
  no VAD) with explicit user overrides
- [x] DS-400 — named VAD profiles (fast_callouts/natural_conversation/
  meeting) as a catalog producing VadConfig
- [x] DS-401 — segmentation diagnostics (forced splits, short fragments,
  rapid segments, trailing silence, empty-high-speech) without storing raw
  audio
- [x] DS-402 — deterministic calibration recommendations (rules, not
  generated text)
- [x] DS-500 — virtual-cable detection (playback/recording candidates,
  confidence, warnings; multi-cable, renamed, missing, inactive cases)
- [x] DS-501 — setup-wizard state machine (pure reducer; forward/back/
  cancel/refresh/save; per-step validation)
- [x] DS-502 — use-case selection catalog (VALORANT/Discord/Meeting/
  Browser call/Other) with suggested presets, origins, VAD profiles
- [x] DS-503 — device refresh keeps the use case and re-runs detection
- [x] DS-504 — routing instructions per use case + critical CABLE copy
- [x] DS-505 — capture/monitoring selection validation (loop prevention:
  monitoring must not route into the cable)
- [x] DS-506 — voice-signal test decision (silent/very_quiet/healthy/
  clipping, deterministic thresholds)
- [x] DS-507 — isolation test decision (passed/inconclusive/
  non_voice_leak/no_voice)
- [x] DS-508 — reusable routing profiles (schema, save/load/delete,
  profile-from-wizard builder, missing-endpoint recovery view)
- [x] DS-509 — Fix-Audio-Setup recovery: endpoint replacement without
  recreating the profile; reset-only-this-profile
- [x] DS-600 — preset resolver (user override > source override > domain
  preset > origin default > global default) with diagnostics reasons
- [x] DS-601/603/606 — preset validation: General preset carries no game
  vocabulary; no preset embeds provider ids; VAD profile references
  resolve; terminology tests
- [x] DS-602 — VALORANT workflow preserved via the preset builder (tests
  pin the default source config to the valorant-team preset)
- [x] DS-604 — Home quick-start: SavedProfilesPanel on the Live page starts
  a routing profile with one click; missing endpoints show recovery UI
- [x] DS-605 — Basic/Advanced split: Quality selector (fast/balanced/
  best_quality/low_memory) in Basic; ASR/translation providers + VAD +
  caption mode behind an Advanced collapsible
- [x] DS-700 — recognition plan types (RecognitionRequest/RecognitionPlan)
- [x] DS-701 — hardware capability snapshot (OS/arch/CUDA visibility vs
  usable runtime/VRAM/Apple Silicon/CPU class/installed models)
- [x] DS-702 — deterministic routing table: language first, then hardware
  and quality; missing models degrade to documented fallbacks; unsupported
  languages never route to an unrelated decoder
- [x] DS-703 — RoutingAsrProvider orchestration: provisional provider A,
  final provider B, stale provisionals can never supply finals
- [x] DS-704 — Paraformer honesty: labeled a fast whole-utterance provider
  (not true streaming) in code + catalog
- [x] DS-705 — SenseVoice language-aware: per-language recognizer cache
  (zh/en forced from source modes, auto otherwise)
- [x] DS-707/708/709 — fallback eligibility signals, bounded fallback
  execution on finals only (primary retained on failure), deterministic
  primary-vs-fallback selection (non-empty, repetition, confidence gap)

## Next task

DS-706 — contextual Whisper configuration (bounded prompt/hotwords).

## Decisions that must not be reversed

- Hard safety boundaries (no injection, no memory reads, no automation) —
  see `docs/09_SECURITY_PRIVACY_RIOT_COMPLIANCE.md`.
- No silent fallback to an unrelated language (DEC-001).
- Local-first default workflow.
- Bounded queues; no unbounded buffering in audio/inference paths.
