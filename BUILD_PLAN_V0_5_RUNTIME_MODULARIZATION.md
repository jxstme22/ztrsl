# xTRSNLTR v0.5.0 Build Plan

## Runtime Modularization and Measured Performance

**Depends on:** v0.4 accuracy baselines and fixtures  
**Primary question:** Can xTRSNLTR use fewer resources without destabilizing the working pipeline?

## 1. Purpose

v0.5 is not a full Rust rewrite.

Its goal is to:

- modularize inference runtimes;
- load only providers actually used;
- reduce idle overhead;
- reduce frame-level IPC;
- isolate provider failures;
- move only proven components into native code;
- keep Python fallbacks until replacements pass parity tests.

The app should become lighter through:

1. native VAD and utterance segmentation;
2. optional runtime packs;
3. loading fewer inference runtimes;
4. loading only active models;
5. reducing IPC during silence;
6. isolating provider processes;
7. native Omnilingual where it gives measurable benefit.

## 2. What remains unchanged

Keep compatible:

- Tauri control UI;
- overlay;
- editable source names and tags;
- VB-CABLE routing;
- multi-source configuration;
- language profiles and strictness;
- phrase filters;
- glossary;
- caption certainty;
- Accuracy Lab;
- model catalog and settings.

Changes belong behind:

```text
source audio → VAD → utterance → ASR provider
→ translation provider → caption
```

## 3. Goals

1. Add runtime-neutral ASR and MT contracts.
2. Wrap existing Python providers behind those contracts.
3. Move Silero VAD and utterance segmentation into native code.
4. Send utterances instead of continuous frames where practical.
5. Add native Omnilingual as an optional provider.
6. Keep faster-whisper in Python unless evidence supports migration.
7. Add modular runtime packs.
8. Add model residency and safe hot swapping.
9. Isolate provider crashes.
10. Benchmark size, startup, RAM, VRAM, latency, and IPC volume.

## 4. Non-goals

Do not:

- delete Python immediately;
- rewrite Whisper for architectural purity;
- change caption semantics;
- change routing UX;
- remove working providers before parity passes;
- combine installer/public-beta work from v0.6 into this release.

## 5. Target architecture

```text
Tauri/Rust desktop
├── audio-core
├── native VAD + utterance manager
├── shared scheduler
├── provider supervisor
│   ├── Python Whisper
│   ├── Python NLLB
│   ├── Native Omnilingual
│   ├── MADLAD Candle runner
│   └── fallback legacy providers
└── overlay
```

## 6. Provider contracts

```rust
#[async_trait]
pub trait AsrProvider: Send + Sync {
    async fn load(&mut self, model: &InstalledModel) -> Result<()>;
    async fn transcribe(&self, job: AsrJob) -> Result<AsrResult>;
    async fn unload(&mut self) -> Result<()>;
    fn capabilities(&self) -> RuntimeCapabilities;
    fn health(&self) -> ProviderHealth;
}
```

```rust
#[async_trait]
pub trait TranslationProvider: Send + Sync {
    async fn load(&mut self, model: &InstalledModel) -> Result<()>;
    async fn translate(&self, job: TranslationJob) -> Result<TranslationResult>;
    async fn unload(&mut self) -> Result<()>;
    fn capabilities(&self) -> RuntimeCapabilities;
    fn health(&self) -> ProviderHealth;
}
```

Runtime kinds:

```rust
pub enum RuntimeKind {
    PythonSidecar,
    SherpaOnnxNative,
    OnnxRuntimeNative,
    CandleNative,
    ExternalRunner,
    Fake,
}
```

Requirements:

- scheduler is runtime-agnostic;
- model manifests declare runtime requirements;
- health and errors are normalized;
- provider failure cannot crash the desktop.

## 7. Native VAD

Current:

```text
Rust audio → many small IPC frames → Python VAD → utterance
```

Target:

```text
Rust audio → native Silero VAD → native utterance manager
→ complete utterance IPC → ASR
```

Keep both temporarily:

```yaml
vad_runtime: python | native
```

Measure:

- IPC messages per minute;
- idle CPU;
- segmentation parity;
- queue pressure;
- latency;
- memory.

Requirements:

- one VAD and utterance manager per source;
- audio monitoring remains independent;
- raw-frame debug path behind developer flag;
- Python fallback retained through v0.5.

## 8. Native Omnilingual

Add:

```text
Omnilingual
├── Python provider
└── Native sherpa-onnx provider
```

Parity matrix:

- Cebuano;
- Filipino;
- English;
- Mandarin;
- mixed speech;
- short callouts;
- long utterances;
- corrupted model;
- repeated load/unload.

Compare:

- normalized transcript;
- latency;
- startup;
- RAM;
- VRAM;
- installer/runtime size;
- crash behavior.

Native becomes default only with measurable advantage.

## 9. Whisper strategy

Keep:

```text
Whisper → Python faster-whisper/CTranslate2 provider
```

Do not rewrite by default.

A native migration requires proof of:

- equal or better text;
- lower memory or latency;
- smaller packaging;
- acceptable maintenance cost.

## 10. Translation runtime strategy

Support one provider contract across:

- Python NLLB;
- Rust Candle MADLAD;
- future validated native/runner options.

Example job:

```json
{
  "job_id": "uuid",
  "model_id": "madlad400-3b",
  "source_language": "ceb",
  "target_language": "en",
  "text": "..."
}
```

Select runtime per model, not per preferred programming language.

## 11. Runtime packs

Core:

```text
xTRSNLTR Core
├── desktop
├── audio
├── overlay
├── native VAD
└── provider supervisor
```

Optional:

```text
Whisper GPU Runtime Pack
Whisper CPU Runtime Pack
Native Omnilingual Runtime Pack
NLLB Runtime Pack
MADLAD Runtime Pack
Developer Diagnostics Pack
```

Pack manifest includes:

- ID/version;
- platform/architecture;
- signature/hash;
- compatible app versions;
- supported models;
- disk size;
- license;
- dependencies.

Benefits:

- smaller core installation;
- users install only selected runtimes;
- independent updates;
- clearer licensing;
- easier China/offline delivery in v0.6.

## 12. Model residency manager

```rust
pub enum ResidencyState {
    NotLoaded,
    Loading,
    Ready,
    Draining,
    Unloading,
    Failed,
}
```

Rules:

- pin active TEAM ASR;
- pin active MT;
- unload inactive models;
- never unload during inference;
- drain work before unload;
- reserve memory budget;
- health-check after warmup;
- rollback on failure.

Switch flow:

```text
pause new jobs → finish active job → drain
→ unload old model → free memory
→ load new model → warm up → health check → resume
```

## 13. Resource governor

Inputs:

- RAM and free RAM;
- VRAM and free VRAM;
- model estimates;
- active source count;
- ASR real-time factor;
- MT latency;
- queue depth;
- recent OOM.

Temporary actions:

- disable secondary provisional work;
- increase provisional interval;
- move eligible MT to CPU;
- unload inactive provider;
- activate a user-approved fallback.

Never permanently change the selected model silently.

## 14. Provider supervision

Improve:

- provider-specific startup phases;
- crash-loop protection;
- restart backoff;
- job draining;
- deterministic shutdown;
- independent health;
- content-free crash report.

Example:

```text
Whisper provider crashes
→ audio monitoring continues
→ native Omnilingual remains available
→ affected source reports degraded state
→ user may restart or switch provider
```

# 15. Versioned Build Sequence

## v0.5.0 — Runtime abstraction

Tasks:

- add provider traits;
- wrap current Python implementation;
- add capability manifests;
- normalize provider health;
- preserve output.

**Acceptance:** v0.4 behavior is unchanged behind new interfaces.

## v0.5.1 — Native VAD

Tasks:

- integrate Silero ONNX in Rust;
- add native utterance manager;
- add utterance-level IPC;
- retain Python fallback;
- benchmark.

**Acceptance:** segmentation parity and reduced silent IPC are proven.

## v0.5.2 — Native Omnilingual

Tasks:

- native sherpa-onnx provider;
- model/runtime mapping;
- parity suite;
- provider selection;
- Python fallback.

**Acceptance:** measurable benefit and no caption regression.

## v0.5.3 — Runtime packs

Tasks:

- signed pack schema;
- optional install/remove;
- dependencies;
- license display;
- active-use protection.

**Acceptance:** core app runs without every provider installed.

## v0.5.4 — Model residency

Tasks:

- residency states;
- safe load/unload;
- memory budget;
- warmup;
- rollback;
- leak tests.

**Acceptance:** repeated switching is stable and bounded.

## v0.5.5 — Resource governor

Tasks:

- dynamic policy;
- queue integration;
- user-approved fallback;
- resource dashboard.

**Acceptance:** low-priority work reduces under pressure while finals remain safe.

## v0.5.6 — Provider isolation and cleanup

Tasks:

- isolate runners/processes;
- crash-loop protection;
- remove dead legacy paths only after proof;
- document final metrics.

**Acceptance:** one provider crash does not terminate all inference.

## 16. Required benchmarks

| Metric                      | Required |
| --------------------------- | -------- |
| Core installation size      | Yes      |
| Runtime pack size           | Yes      |
| Startup time                | Yes      |
| Model warmup time           | Yes      |
| Idle/active RAM             | Yes      |
| Idle/active CPU             | Yes      |
| VRAM                        | Yes      |
| First/final caption latency | Yes      |
| IPC messages per minute     | Yes      |
| Four-hour memory growth     | Yes      |
| Caption parity              | Yes      |

A migration is accepted only when it gives measurable value.

## 17. Release Criteria

- [ ] Runtime-neutral provider contracts.
- [ ] Existing Python providers still work.
- [ ] Native VAD stable.
- [ ] Utterance-level IPC works.
- [ ] At least one ASR path works without Python.
- [ ] Whisper remains supported.
- [ ] Runtime packs are optional.
- [ ] Only active providers/models load.
- [ ] Hot switching is safe.
- [ ] Provider failures are isolated.
- [ ] Four-hour soak is bounded.
- [ ] Measurable performance/size benefit exists.
- [ ] User-facing captions do not regress.
- [ ] Safety and privacy boundaries remain intact.

## 18. Codex Prompt

```text
Read AGENTS.md, README.md, the v0.4 validation report, and this file.

Do not perform a big-bang rewrite. First put all current paths behind stable
provider contracts. Migrate one component at a time and preserve fallbacks.

Do not rewrite Whisper unless benchmarks justify it. Do not make complete
Python removal a release requirement.

For every subrelease:
1. state acceptance criteria;
2. preserve fallback;
3. add parity tests;
4. benchmark before and after;
5. run all checks;
6. document measurable benefit;
7. remove old code only after proof.
```
