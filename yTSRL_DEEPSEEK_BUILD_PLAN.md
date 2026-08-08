# yTSRL Generalization Build Plan

## DeepSeek Flash Execution Edition

**Target repository:** `jxstme22/ztrsl`  
**Primary outcome:** A clean, reliable, general-purpose real-time subtitle and translation application, with VALORANT retained as an optimized preset rather than a core architectural assumption.

---

# 1. Why This Plan Is Structured Differently

This plan is designed for implementation by a smaller coding model that performs best when:

- each task has one clear goal;
- the editable file set is small;
- architectural decisions are already made;
- non-goals are explicit;
- expected tests are listed before implementation;
- the model is not asked to infer hidden dependencies;
- every phase ends at a verifiable checkpoint.

Do not ask DeepSeek to implement an entire phase in one prompt. Each numbered task below should be treated as a separate implementation session or a separate carefully reviewed patch.

The intended workflow is:

```text
Read task packet
    ↓
Inspect only required files
    ↓
Restate current behavior
    ↓
Propose a minimal patch
    ↓
Implement
    ↓
Run focused tests
    ↓
Run regression checks
    ↓
Summarize changed behavior
    ↓
Commit
```

---

# 2. Product Definition

yTSRL should provide real-time local subtitles and translation for:

- game voice channels;
- Discord and other voice platforms;
- online meetings;
- general conversations;
- livestream overlays;
- language-learning sessions;
- accessibility-focused caption use.

The application should remain local-first. External services can remain optional providers, but the default workflow must work locally.

## 2.1 Core promise

```text
Cleanly routed audio
→ reliable speech segmentation
→ language-aware recognition
→ accurate final captions
→ readable translation
```

## 2.2 Product hierarchy

VALORANT is not removed. It becomes one domain preset:

```text
General platform
├── General Conversation preset
├── VALORANT preset
├── Gaming preset
├── Discord preset
├── Meeting preset
├── Streaming preset
├── Language Learning preset
└── Accessibility preset
```

## 2.3 Non-goals for this roadmap

- Automatic modification of operating-system audio routing without clear user action
- Universal speaker diarization
- Aggressive processing on already isolated virtual-cable audio
- Full desktop-audio source separation
- A large language model in the live critical path
- Loading every speech model simultaneously
- Rewriting the entire application architecture

---

# 3. DeepSeek Operating Contract

Use this contract in every coding prompt.

## 3.1 Scope rules

DeepSeek must:

1. Modify only files explicitly allowed by the task.
2. Ask for or inspect any missing file before guessing its structure.
3. Preserve current behavior unless the task explicitly changes it.
4. Add or update tests in the same patch.
5. Avoid unrelated formatting, renaming, and cleanup.
6. Avoid adding dependencies unless the task explicitly permits it.
7. Preserve protocol backward compatibility when requested.
8. Report every command run and whether it passed.
9. Stop when a required assumption is false.
10. Never proceed to the next task automatically.

## 3.2 Required response format for each task

DeepSeek should respond in this order:

```text
1. Current behavior found
2. Minimal implementation approach
3. Files to change
4. Patch
5. Tests added or changed
6. Commands run
7. Results
8. Remaining risks
```

## 3.3 Hard stop conditions

DeepSeek must stop without coding when:

- an allowed file does not contain the expected code;
- an API or data type differs materially from the task description;
- a schema migration would destroy existing user settings;
- a required test command cannot be identified;
- the task requires a new dependency that was not approved;
- more than five production files appear necessary for a task scoped to fewer files;
- the patch would alter unrelated provider behavior;
- the patch would silently change audio routing.

## 3.4 Patch-size rule

Preferred patch size:

```text
1–3 production files
1–3 test files
One behavioral change
One commit
```

A task that exceeds this should be split.

---

# 4. Repository Context to Give DeepSeek

Before implementation begins, create a short context document in the repository:

`docs/GENERALIZATION_CONTEXT.md`

It should contain:

- product goal;
- current release version;
- canonical test commands;
- current provider list;
- current source-profile identifiers;
- current protocol version;
- supported operating systems;
- known architectural constraints;
- completed task IDs;
- next task ID;
- decisions that must not be reversed.

Also create:

`docs/GENERALIZATION_DECISIONS.md`

Every architectural decision should use:

```markdown
## DEC-001: No silent fallback to an unrelated language

**Status:** Accepted  
**Reason:** A wrong forced decoder language can cause severe recognition errors.  
**Decision:** Unknown or automatic profiles remain unconstrained rather than falling back to Filipino.  
**Consequences:** Provider selection and UI must handle `auto` explicitly.
```

DeepSeek should read both documents at the beginning of every task.

---

# 5. Release Structure

The upgrade is divided into three release trains.

## v0.8 — General Foundation

Focus:

- correctness;
- audio reliability;
- general source data model;
- preset foundation;
- easy VB-CABLE setup;
- clean primary interface.

## v0.9 — Recognition Quality

Focus:

- two-stage recognition;
- language-aware routing;
- contextual vocabulary;
- confidence fallback;
- adaptive segmentation;
- measurable accuracy.

## v1.0 — General Product

Focus:

- polished modes;
- exports and streaming output;
- clean-machine reliability;
- recovery workflows;
- complete documentation and QA.

---

# 6. Phase 0 — Freeze the Baseline

## Goal

Establish known-good behavior, canonical commands, and measurable benchmarks before changing architecture.

## Exit condition

No production behavior changes. The repository has a reproducible baseline and a generalization context file.

---

## DS-000 — Create the implementation branch

### Goal

Create a dedicated branch from the current default branch.

### Suggested branch

```text
feat/general-purpose-v0.8
```

### Rules

- Do not modify production files.
- Record the starting commit SHA.
- Record the current application version.

### Acceptance

- Branch exists.
- Starting SHA is written to `docs/GENERALIZATION_CONTEXT.md`.

---

## DS-001 — Discover canonical verification commands

### Goal

Identify the commands already used by the repository for Python, Rust, desktop UI, formatting, linting, and packaging.

### Inspect

- root `package.json`
- workspace configuration
- `pyproject.toml`
- Rust workspace files
- CI workflow files
- contributor or agent documentation

### Deliverable

Add a command table to `docs/GENERALIZATION_CONTEXT.md`:

```markdown
| Area          | Focused command | Full command |
| ------------- | --------------- | ------------ |
| Python tests  | ...             | ...          |
| Python typing | ...             | ...          |
| Rust tests    | ...             | ...          |
| Desktop tests | ...             | ...          |
| Typecheck     | ...             | ...          |
| Lint          | ...             | ...          |
| Format check  | ...             | ...          |
```

### Acceptance

- Commands come from existing repository configuration.
- No invented package script is listed.
- At least one successful baseline run is recorded for every available test family.

---

## DS-002 — Inventory current behavior

### Goal

Document the current implementation without changing it.

### Inspect at minimum

- `services/inference/src/local_squad_inference/providers.py`
- `services/inference/src/local_squad_inference/sidecar.py`
- `services/inference/src/local_squad_inference/live.py`
- `services/inference/src/local_squad_inference/vad.py`
- `services/inference/src/local_squad_inference/protocol.py`
- `services/inference/src/local_squad_inference/scheduler.py`
- `apps/desktop/src/sources/profiles.ts`
- `apps/desktop/src/live/bridge.ts`
- `apps/desktop/src/components/LiveTranslationPanel.tsx`

### Record

- source-profile IDs;
- mapping from profile to ASR source mode;
- ASR providers;
- translation providers;
- provisional-caption cadence;
- final-caption path;
- audio queue behavior;
- VAD defaults;
- model-selection persistence;
- current setup or onboarding screens;
- source persistence format.

### Acceptance

`docs/GENERALIZATION_CONTEXT.md` accurately describes the existing code and cites file paths and symbol names.

---

## DS-003 — Add benchmark fixture schema

### Goal

Define a stable format for evaluating recognition without committing private user recordings.

### Add

```text
services/inference/evaluation/fixtures/README.md
services/inference/evaluation/fixtures/manifest.example.json
```

### Example schema

```json
{
  "schema_version": 1,
  "clips": [
    {
      "id": "zh-clean-001",
      "audio_path": "private/zh-clean-001.wav",
      "reference_text": "他们两个在B点后面",
      "primary_language": "zh",
      "secondary_languages": ["en"],
      "domain": "gaming",
      "source_origin": "virtual_voice_channel",
      "conditions": ["clean", "short_callout"],
      "private": true
    }
  ]
}
```

### Metrics to support later

- Chinese character error rate
- Word error rate
- Empty transcript rate
- Hallucination rate
- Beginning-clipped rate
- Ending-clipped rate
- Final latency
- Language mismatch rate

### Acceptance

- Example manifest validates.
- Private audio directories are ignored by Git.
- No personal recording is committed.

---

# 7. Phase 1 — Correctness Before Features

## Goal

Remove defects that make all later model comparisons unreliable.

## Dependency

Phase 0 complete.

## Exit condition

Language routing is correct, non-speech filtering is safe, and normal audio is not silently lost.

---

## DS-100 — Add regression tests for language routing

### Goal

Write failing tests that expose the current profile-to-source-mode problem before changing implementation.

### Primary files

- sidecar profile-routing tests
- `services/inference/src/local_squad_inference/sidecar.py`

### Required cases

```text
mandarin         → chinese
chinese          → chinese, for backward compatibility if still accepted
chinese_english  → a mixed/primary-preferred configuration, never filipino
tagalog          → filipino
taglish          → filipino
cebuano          → filipino until a dedicated decoder mode exists
auto             → unconstrained/auto, never filipino
unknown          → unconstrained or explicit validation error
```

### Important

Do not implement the fix in this task. Add tests and confirm the relevant tests fail for the expected reason.

### Acceptance

- Tests fail because of current mapping behavior.
- No production behavior changes.

---

## DS-101 — Fix profile-to-language routing

### Goal

Remove the silent Filipino fallback and align desktop profile IDs with sidecar behavior.

### Primary files

- `services/inference/src/local_squad_inference/sidecar.py`
- related sidecar tests

### Required behavior

Create one explicit mapping table.

Pseudo-structure:

```python
PROFILE_SOURCE_MODES = {
    "mandarin": "chinese",
    "chinese": "chinese",
    "tagalog": "filipino",
    "taglish": "filipino",
    "cebuano": "filipino",
    "bislish": "filipino",
    "english": "english",
    "indonesian": "indonesian",
    "vietnamese": "vietnamese",
    "thai": "thai",
    "malay": "malay",
}
```

For `auto` and `chinese_english`, do not force Filipino. Use an explicit unconstrained or primary-preferred path. If current protocol types cannot express it, keep this task minimal:

- `mandarin` must map to Chinese;
- `auto` must use the session source mode rather than Filipino;
- `chinese_english` must not map to Filipino;
- record a follow-up task for the full language configuration model.

### Invariants

- Existing Filipino-family behavior remains unchanged.
- Existing `"chinese"` compatibility remains.
- Unknown profiles do not silently select an unrelated language.

### Acceptance

- DS-100 tests pass.
- Existing sidecar tests pass.
- A multi-source Mandarin source reaches Whisper with `language="zh"`.

---

## DS-102 — Test Whisper segment filtering

### Goal

Add tests for the custom no-speech decision.

### Cases

Keep:

- high `no_speech_prob` with strong `avg_logprob`;
- short high-confidence Chinese text;
- one-word tactical speech;
- normal speech with punctuation.

Drop:

- empty text;
- high `no_speech_prob` and poor `avg_logprob`;
- exact known hallucination phrase;
- non-finite or invalid segment data if current code supports guarding it.

### Acceptance

Tests reveal whether the current hard threshold incorrectly removes confident speech.

---

## DS-103 — Correct Whisper segment filtering

### Goal

Use a joint silence decision rather than rejecting on `no_speech_prob` alone.

### Primary files

- `services/inference/src/local_squad_inference/providers.py`
- provider tests

### Required behavior

Conceptually:

```python
if no_speech_prob >= limit and avg_logprob < logprob_limit:
    drop
```

Do not broadly change decoding parameters in the same patch.

### Invariants

- Known isolated hallucination phrases are still filtered.
- Empty segments are still filtered.
- Confidence calculation remains compatible.

### Acceptance

- DS-102 tests pass.
- Provider regression tests pass.
- No model loading is required for unit tests.

---

## DS-104 — Instrument raw-audio queue loss

### Goal

Make every dropped audio packet measurable before changing queue behavior.

### Primary files

- live worker or sidecar worker implementation
- protocol/diagnostic type only if necessary
- worker tests

### Required metrics

- packets submitted;
- packets consumed;
- packets dropped;
- maximum observed queue depth;
- provisional jobs dropped;
- final jobs dropped.

### UI behavior

A temporary advanced diagnostic surface is sufficient. Do not redesign the UI in this task.

### Acceptance

- A queue-overload test produces a nonzero raw packet-drop metric.
- Normal operation test reports zero.
- Metrics are per session, and per source where practical.

---

## DS-105 — Remove latest-wins behavior from raw audio

### Goal

Raw audio must remain ordered and must not be intentionally discarded during normal supported operation.

### Design

Do not let the capture callback block indefinitely.

Preferred architecture:

```text
Capture callback
→ bounded per-source audio ring or packet queue
→ VAD consumer
→ inference scheduler
```

Overload policy:

1. Coalesce stale provisional ASR jobs.
2. Stop scheduling new provisional jobs temporarily.
3. Preserve final utterance jobs.
4. Surface an overload warning.
5. Preserve raw audio within the supported buffer window.

### Split rule

If implementing a ring buffer requires broad changes, divide into:

- DS-105A: change overload behavior to suppress provisionals before audio queue fills;
- DS-105B: add bounded per-source audio buffering;
- DS-105C: expose recovery state.

### Invariants

- Packet order remains monotonic.
- Source IDs remain attached.
- VAD receives continuous samples.
- Final captions remain terminal.
- No busy-waiting.

### Acceptance

- Stress test shows zero raw packet drops for the defined supported load.
- Provisional jobs may be dropped and are counted.
- Final jobs are not silently discarded.
- The session remains responsive.

---

# 8. Phase 2 — General Domain Model

## Goal

Replace hardcoded game/language assumptions with explicit, reusable source configuration.

## Dependency

Phase 1 complete.

## Exit condition

Each source has a source origin, language configuration, preset, and quality profile. Existing user settings migrate safely.

---

## DS-200 — Define source-origin types

### Goal

Add a stable source-origin enum/type shared across the appropriate desktop and protocol layers.

### Required values

```text
virtual_voice_channel
physical_microphone
application_audio
system_mix
recorded_file
```

### Important

This field describes the audio’s origin. It does not replace the capture endpoint.

### Defaults

For existing sources:

- virtual cable endpoint names may migrate to `virtual_voice_channel`;
- physical input devices may migrate to `physical_microphone`;
- uncertain cases migrate to a safe generic value or require user review.

Do not rely only on display-name heuristics in runtime behavior. Migration heuristics may suggest a value, but users must be able to edit it.

### Acceptance

- Type exists.
- Serialization round-trip passes.
- Existing saved sources load.
- Unknown future values fail safely or map to a documented default.

---

## DS-201 — Define `LanguageConfig`

### Goal

Replace a single profile string as the sole representation of recognition language behavior.

### Data model

```typescript
type DetectionMode =
  "fixed" | "primary_preferred" | "limited_auto" | "full_auto";

type LanguageConfig = {
  primaryLanguage: string | null;
  secondaryLanguages: string[];
  detectionMode: DetectionMode;
};
```

Equivalent strict Python protocol types should be added where configuration crosses IPC.

### Validation

- `fixed` requires a primary language.
- `primary_preferred` requires a primary language.
- `limited_auto` requires at least one allowed language.
- `full_auto` may have no language hints.
- Primary language cannot be duplicated in secondary languages.
- Language identifiers use one canonical format.

### Compatibility adapter

Map current profiles:

```text
mandarin          → zh, fixed
chinese_english   → zh + en, primary_preferred
tagalog           → tl, fixed
taglish           → tl + en, primary_preferred
cebuano           → ceb + en if supported by selected provider policy
bislish           → ceb + en, primary_preferred
auto              → full_auto
```

Provider limitations are handled later by the router. The data model should represent user intent accurately.

### Acceptance

- Validation tests pass.
- Old profile settings convert deterministically.
- New settings serialize across desktop and sidecar.
- No unrelated provider behavior changes yet.

---

## DS-202 — Define domain presets

### Goal

Create data-only preset definitions without changing live behavior.

### Initial preset IDs

```text
general
valorant
gaming
discord
meeting
streaming
language_learning
accessibility
```

### Preset fields

```typescript
type DomainPreset = {
  id: string;
  displayName: string;
  vadProfileId: string;
  captionProfileId: string;
  latencyProfileId: string;
  glossaryPackId: string | null;
  hotwordPackId: string | null;
  overlapPolicy: string;
  contextPolicy: string;
};
```

### Rules

- Presets reference other configuration; they do not duplicate full provider logic.
- User overrides are stored separately.
- Updating a preset must not overwrite explicit user overrides.

### Acceptance

- Presets load from one catalog.
- Catalog has schema validation.
- Unit tests verify unique IDs and valid references.

---

## DS-203 — Define user-facing quality profiles

### Goal

Separate UI quality choices from raw model IDs.

### Required profiles

```text
fast
balanced
best_quality
low_memory
```

### Data model

Quality profiles should express policy, not fixed model names:

```typescript
type QualityProfile = {
  provisionalPolicy: "enabled" | "reduced" | "disabled";
  finalAccuracyPriority: number;
  maximumExpectedLatencyMs: number;
  allowFallbackDecode: boolean;
  memoryClass: "low" | "medium" | "high";
};
```

The model router will resolve actual providers in Phase 6.

### Acceptance

- UI can persist a quality-profile ID.
- Existing raw provider selection remains available in Advanced Mode.
- No provider is removed.

---

## DS-204 — Add settings migration

### Goal

Safely migrate existing users.

### Migration requirements

- Version the persisted source/settings schema.
- Preserve endpoint IDs.
- Preserve source names, tags, colors, priorities, and monitoring settings.
- Convert profile strings into `LanguageConfig`.
- Assign a conservative preset.
- Do not reset model downloads.
- Do not silently delete unknown fields.

### Required tests

- old schema fixture → new schema;
- already-new schema → unchanged;
- partially corrupt schema → recoverable error or safe defaults;
- unknown profile → full auto or explicit review flag, not Filipino;
- migration is idempotent.

### Acceptance

Migration tests pass and a rollback copy of old settings is retained where architecture allows.

---

# 9. Phase 3 — Audio Reliability and Source Health

## Goal

Make input quality and routing failures obvious and recoverable.

## Exit condition

The application can distinguish isolated audio, silent routing, clipping, overload, and monitoring loops.

---

## DS-300 — Add audio health metrics

### Metrics per source

- input sample rate;
- channel count;
- RMS level;
- peak level;
- clipping ratio;
- zero-sample ratio;
- non-finite sample count;
- VAD speech probability or speech-frame ratio;
- packets received;
- packets dropped;
- queue depth;
- open utterance duration;
- forced-split count.

### Design

Compute cheap metrics in the audio/VAD path. Avoid expensive transforms in the capture callback.

### Acceptance

- Metrics update during a live source.
- Metrics reset predictably at session start.
- Metric collection does not materially increase latency.

---

## DS-301 — Add source-health states

### Required states

```text
ready
silent
very_quiet
clipping
format_error
overloaded
disconnected
monitoring_loop_suspected
```

### Rules

- Use deterministic thresholds stored in one module.
- Include a human-readable explanation and one recommended action.
- Do not diagnose a monitoring loop solely from endpoint name equality; combine endpoint configuration and signal behavior where possible.

### Acceptance

Unit tests cover each state and priority when multiple problems exist.

---

## DS-302 — Add conservative audio normalization

### Goal

Provide optional light normalization only where appropriate.

### Rules

- Default off for `virtual_voice_channel`.
- Available for `physical_microphone`.
- Cap gain.
- Never normalize non-finite data.
- Never hard-clip output.
- Record whether processing was applied.

### Non-goal

Do not add a full enhancement pipeline in this task.

### Acceptance

- Quiet speech receives bounded gain.
- Normal speech remains almost unchanged.
- Loud speech is not amplified.
- Tests cover silence and clipping.

---

## DS-303 — Add source-origin processing policy

### Defaults

#### Virtual voice channel

```text
normalization: off or light
additional suppression: off
echo handling: off
VAD: enabled
```

#### Physical microphone

```text
normalization: light
additional suppression: user-selectable
echo handling: user-selectable
VAD: enabled
```

#### System mix

```text
normalization: off
stricter speech validation: enabled
VAD: enabled
```

### Acceptance

- Policy resolves deterministically from source origin.
- Explicit user overrides win.
- Changing source origin previews the settings it will alter before saving.

---

# 10. Phase 4 — VAD and Segmentation Profiles

## Goal

Make segmentation appropriate for short game callouts, ordinary conversation, and meetings.

## Exit condition

Users select a use case, not raw timing numbers, while Advanced Mode retains controls.

---

## DS-400 — Add named VAD profiles

### Required profiles

#### `fast_callouts`

```text
pre-roll: approximately 320 ms
end silence: approximately 450 ms
maximum utterance: approximately 12–15 s
```

#### `natural_conversation`

```text
pre-roll: approximately 400 ms
end silence: approximately 750 ms
maximum utterance: approximately 25 s
```

#### `meeting`

```text
pre-roll: approximately 450 ms
end silence: approximately 1100 ms
maximum utterance: approximately 40 s
```

Exact values should be finalized through benchmark data, not assumed permanently.

### Implementation

Keep the existing `VadConfig` as the low-level type. Add a catalog that produces it.

### Acceptance

- Every domain preset references a valid VAD profile.
- Existing custom sensitivity behavior remains available.
- Unit tests validate timing boundaries and IDs.

---

## DS-401 — Add segmentation diagnostics

### Track

- utterance duration;
- leading pre-roll duration;
- trailing silence included;
- forced split;
- empty ASR result with high speech probability;
- short fragment count;
- rapid consecutive segments.

### Acceptance

Diagnostics can identify likely clipped beginnings, clipped endings, and excessive splitting without storing raw audio.

---

## DS-402 — Add calibration recommendations

### Deterministic recommendations

Examples:

```text
Many short fragments
→ increase end-silence duration

Frequent forced splits
→ increase maximum utterance or use Meeting preset

High speech probability with empty text
→ inspect ASR language/model before changing VAD

Very quiet input
→ increase application output or enable light normalization

Repeated clipped beginnings
→ increase pre-roll
```

### Acceptance

- Recommendations are rules, not generated text.
- Tests cover trigger thresholds.
- No setting changes automatically without user action.

---

# 11. Phase 5 — VB-CABLE Guided Setup

## Goal

A first-time Windows user should configure isolated application or voice-channel audio without external documentation.

## Exit condition

A user can complete routing, monitoring, signal testing, isolation testing, and save a reusable profile.

---

## DS-500 — Add virtual-cable device detection

### Goal

Classify likely VB-CABLE endpoints from enumerated Windows devices.

### Detection candidates

Common user-facing names can include:

```text
CABLE Input
CABLE Output
VB-Audio Virtual Cable
```

### Rules

- Store stable endpoint IDs, not only names.
- Names are detection hints.
- Do not assume one cable installation.
- Allow manual selection.
- Refresh enumeration without restarting the entire app.

### Output type

```typescript
type VirtualCableDetection = {
  playbackCandidates: AudioEndpoint[];
  recordingCandidates: AudioEndpoint[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
```

### Acceptance

- Mock-device tests cover normal, renamed, missing, and multiple-cable cases.
- Manual override always remains available.

---

## DS-501 — Build the setup-wizard state machine

### Steps

```text
choose_use_case
detect_cable
show_routing
select_capture
select_monitor
test_signal
test_isolation
review
saved
```

### Rules

- State survives accidental window navigation.
- Back navigation does not lose valid choices.
- Every step validates only its own requirements.
- Wizard can be cancelled without modifying existing profiles.
- Saving is one atomic operation.

### Acceptance

State-machine unit tests cover forward, back, cancel, refresh, and save.

---

## DS-502 — Build the use-case selection step

### Cards

```text
VALORANT
Discord
Meeting application
Browser call
Other application
```

### Behavior

Selecting a use case loads:

- routing instructions;
- suggested source name;
- suggested preset;
- suggested source origin;
- suggested VAD profile;
- default monitoring behavior.

### Acceptance

No audio device is changed simply by selecting a card.

---

## DS-503 — Build endpoint detection and refresh step

### Required UI states

#### Cable detected

```text
VB-CABLE is available.
```

#### Cable not detected

```text
A virtual audio cable was not found.
```

Actions:

```text
Refresh devices
Open installation instructions
Continue with another source type
```

### Rules

- Do not claim installation success until endpoints enumerate.
- Handle device arrival after refresh.
- Preserve chosen use case across refresh.

### Acceptance

Component tests cover all states.

---

## DS-504 — Build the routing-instruction step

### VALORANT instructions

```text
Game sound output      → Headphones
Voice chat output      → CABLE Input
yTSRL capture source   → CABLE Output
yTSRL monitor output   → Headphones
```

### General application instructions

```text
Application output     → CABLE Input
yTSRL capture source   → CABLE Output
yTSRL monitor output   → Headphones
```

### Critical copy

Explain explicitly:

> Select **CABLE Input** inside the application. Select **CABLE Output** as the recording source inside yTSRL.

### UI requirement

Use a diagram with arrows. Keep names visually distinct.

### Acceptance

- Instructions adapt to selected use case.
- The step does not pretend the app changed external application settings.
- An “Open Windows sound settings” action is available where supported.

---

## DS-505 — Build capture and monitoring selection

### Required validation

- capture endpoint exists;
- monitor endpoint exists when monitoring is enabled;
- capture and monitor combination does not obviously feed back;
- virtual cable output is not accidentally selected as monitoring destination;
- disconnected saved endpoint is clearly marked.

### Acceptance

Invalid combinations cannot be saved without an explicit advanced override.

---

## DS-506 — Implement the voice-signal test

### Test behavior

- Show a live input meter.
- Ask the user to play or receive speech.
- Require a minimum amount of detected speech.
- Detect silence, very quiet signal, healthy signal, and clipping.

### Result examples

```text
Voice detected. Signal level is healthy.
No signal detected. Check that the application outputs to CABLE Input.
Signal is very quiet. Increase the application output volume.
Signal is clipping. Lower the application output volume.
```

### Acceptance

- Test uses existing capture path.
- Test does not start translation models.
- It can be repeated.
- It releases the endpoint cleanly.

---

## DS-507 — Implement the isolation test

### Test sequence

1. Ask user to play game audio or music while no person speaks.
2. Measure activity for a fixed window.
3. Ask user to play or receive voice.
4. Measure speech activity.
5. Compare results.

### Pass concept

```text
non-voice test: low activity
voice test: clear speech activity
```

### Important limitation

This is a routing sanity check, not perfect acoustic classification. Phrase the result honestly.

### Result states

```text
passed
inconclusive
failed_non_voice_leak
failed_no_voice
```

### Acceptance

- Deterministic thresholds.
- User can retry either subtest.
- Inconclusive result does not block advanced users but shows a warning.

---

## DS-508 — Save reusable routing profile

### Saved fields

- profile name;
- selected use case;
- source origin;
- capture endpoint ID;
- monitor endpoint ID;
- monitoring enabled;
- language configuration;
- domain preset;
- quality profile;
- audio processing overrides;
- wizard verification timestamp;
- signal-test result;
- isolation-test result.

### Acceptance

- Saved profile appears on Home and Sources.
- Profile can start a session without reopening the wizard.
- Missing endpoints produce recovery UI, not deletion.

---

## DS-509 — Build “Fix Audio Setup”

### Actions

```text
Refresh devices
Retest capture
Retest monitoring
Retest isolation
Choose a new endpoint
Open routing diagram
Open Windows audio settings
Reset only this profile
```

### Acceptance

- Recovery preserves unrelated settings.
- Device replacement can update endpoint ID without recreating the source.

---

# 12. Phase 6 — Presets and Clean Primary UI

## Goal

Make the app understandable without showing implementation details.

## Exit condition

The normal workflow exposes use case, source, languages, quality, and status. Provider names move to Advanced Mode.

---

## DS-600 — Add preset resolver

### Goal

Resolve:

```text
Domain preset
+ source origin defaults
+ quality profile
+ user overrides
= effective live configuration
```

### Precedence

```text
explicit user override
> saved source override
> domain preset
> source-origin default
> global default
```

### Acceptance

- Resolver is pure and unit-tested.
- Effective configuration can be displayed for diagnostics.
- Updating preset catalogs does not overwrite saved overrides.

---

## DS-601 — Create General Conversation preset

### Defaults

- natural-conversation VAD;
- balanced quality;
- sentence-style captions;
- no domain glossary;
- limited recent context;
- normal overlap handling;
- language configuration selected by user.

### Acceptance

Preset contains no game-specific terms.

---

## DS-602 — Refactor VALORANT into a preset

### Move into preset-owned configuration

- fast-callout VAD;
- compact caption presentation;
- VALORANT glossary;
- VALORANT hotword pack;
- short context;
- source label suggestions;
- VB-CABLE routing guide.

### Invariants

- Existing VALORANT workflow remains available.
- Game-specific vocabulary is not active in General Conversation.
- Preset selection is reversible.

---

## DS-603 — Add Discord, Meeting, Streaming, Language Learning, and Accessibility presets

Implement one preset per task, not all in one patch.

### Meeting

- meeting VAD;
- full-sentence captions;
- longer history;
- export-oriented defaults.

### Discord

- natural conversation or fast conversation;
- virtual voice channel origin;
- source labels;
- balanced quality.

### Streaming

- stable final captions;
- output integration defaults;
- configurable delay.

### Language Learning

- source and translated text shown together;
- language configuration emphasized;
- vocabulary saving enabled.

### Accessibility

- large persistent captions;
- high contrast;
- longer retention;
- keyboard-focused controls.

### Acceptance

Each preset has isolated tests and no hidden provider selection.

---

## DS-604 — Simplify Home screen

### Required information

```text
Active profile
Capture source
Monitoring destination
Spoken languages
Target language
Quality
Audio health
Model readiness
Start button
```

### Example

```text
VALORANT Team
CABLE Output → Headphones
Mandarin + English → English
Balanced quality
Audio ready
Models ready

[Start Captions]
```

### Acceptance

A user can start a saved profile from Home without opening technical settings.

---

## DS-605 — Separate Basic and Advanced settings

### Basic

- use case;
- source;
- monitoring;
- spoken languages;
- target language;
- quality;
- caption appearance.

### Advanced

- raw ASR provider;
- raw translation provider;
- VAD thresholds;
- model device;
- compute type;
- provisional cadence;
- contextual prompt;
- hotwords;
- queue limits.

### Acceptance

Existing expert controls remain accessible.

---

## DS-606 — Generalize terminology

### Replace where appropriate

```text
Team channel     → Audio source
Game voice       → Communication audio
Tactical glossary→ Domain vocabulary
Match/session    → Live session
```

Do not rename internal identifiers merely for cosmetic consistency unless necessary. UI copy can be generalized first.

### Acceptance

General preset screens contain no VALORANT-only wording.

---

# 13. Phase 7 — Recognition Router

## Goal

Use fast recognition for drafts and stronger recognition for final captions without making users manually coordinate models.

## Dependency

Stable domain model, source health, and presets.

## Exit condition

Balanced mode supports provisional and final recognition policies, with safe fallback behavior.

---

## DS-700 — Define recognition-plan types

### Data model

```python
@dataclass(frozen=True)
class RecognitionRequest:
    source_id: str | None
    language_config: LanguageConfig
    domain_preset_id: str
    quality_profile_id: str
    is_provisional: bool
    duration_ms: int
    hardware: HardwareCapabilities


@dataclass(frozen=True)
class RecognitionPlan:
    primary_provider_id: str
    fallback_provider_id: str | None
    language_hint: str | None
    allowed_languages: tuple[str, ...]
    contextual_prompt_id: str | None
    allow_fallback: bool
```

### Important

This task defines types and tests only. Do not change live provider selection yet.

---

## DS-701 — Add hardware capability snapshot

### Capture

- operating system;
- architecture;
- CUDA visibility;
- usable CUDA runtime;
- VRAM class where safely detectable;
- Apple Silicon/Metal availability;
- CPU thread class;
- installed models.

### Rules

- Distinguish GPU visibility from usable runtime.
- Cache safely.
- Allow diagnostics to show why a route was selected.

### Acceptance

Tests mock Windows GPU, Windows CPU fallback, Apple Silicon, and missing models.

---

## DS-702 — Implement deterministic routing table

### Initial routing policy

Keep the policy conservative and based on installed models.

Example intent:

```text
Mandarin provisional
→ fast Chinese-capable provider

Mandarin final
→ best installed Chinese-capable final provider

English final
→ best installed multilingual/English provider

Mixed Chinese-English final
→ code-switch-capable provider

CPU low-memory
→ lightweight provider

Apple Silicon
→ Metal-compatible provider when installed
```

### Rules

- Router returns a plan; it does not load models.
- Every route has a reason string.
- Missing preferred model degrades to a documented fallback.
- No route silently forces an unrelated language.

### Acceptance

Table-driven tests cover language, platform, quality, and missing-model combinations.

---

## DS-703 — Separate provisional and final provider execution

### Goal

Allow one provider for provisional captions and another for final captions.

### Refactor strategy

Prefer introducing an orchestration layer around existing `AsrProvider` implementations rather than changing every provider interface.

### Required behavior

- provisional result is replaceable;
- final result is terminal;
- stale provisional work is cancellable or ignored;
- final work receives the complete utterance;
- final result always has a higher revision;
- provider IDs are recorded separately in diagnostics.

### Acceptance

- Integration test proves provisional provider A and final provider B are both used.
- Stale provisional result cannot overwrite final.

---

## DS-704 — Make streaming Paraformer honest

### Goal

Choose one supported role.

Option A:

- maintain decoder state across incoming chunks;
- emit real streaming provisional results;
- reset state at source stop or utterance boundary.

Option B:

- keep current whole-utterance behavior;
- label it as a fast utterance provider, not a true live streaming provider.

Do not attempt Option A and the two-provider orchestration in the same patch.

### Acceptance

Provider naming and behavior match.

---

## DS-705 — Make SenseVoice language-aware

### Goal

Use explicit language selection when user intent is known.

### Required behavior

```text
fixed Mandarin          → zh
fixed English           → en
fixed Cantonese         → yue, if supported
primary-preferred zh/en → provider-appropriate constrained or auto mode
full auto               → auto
```

### Design

Cache recognizers by supported language configuration if recognizer construction is language-specific.

### Acceptance

Tests verify the requested recognizer mode without loading full models.

---

## DS-706 — Add contextual Whisper configuration

### Goal

Support bounded prompt and hotword inputs.

### Inputs

- active domain vocabulary;
- user custom vocabulary;
- map/session-specific terms where applicable;
- recent high-confidence final context.

### Rules

- prompt length is capped;
- no provisional text enters context;
- low-confidence final text does not enter context;
- context is per source;
- context resets after long silence or source restart;
- General preset receives no game vocabulary.

### Acceptance

Tests verify prompt construction, caps, reset, and source isolation.

---

## DS-707 — Add fallback-decode eligibility

### Trigger conditions

Start with deterministic signals:

- empty transcript with strong VAD evidence;
- confidence below threshold;
- detected language outside allowed set;
- high repetition;
- exact hallucination;
- implausibly short output for a long utterance;
- provider error.

### Important

This task decides whether fallback is eligible. It does not yet choose between two texts.

### Acceptance

Table-driven tests cover every trigger.

---

## DS-708 — Execute fallback decode

### Rules

- Run only on final utterances.
- Respect quality profile.
- Respect resource availability.
- Do not block future audio capture.
- Record primary and fallback latency.
- If fallback fails, retain a valid primary result.
- Never show both as competing final captions.

### Acceptance

Integration tests cover successful fallback, fallback failure, and disabled fallback.

---

## DS-709 — Select between primary and fallback results

### Scoring signals

- confidence where comparable;
- language match;
- empty/non-empty;
- repetition;
- hallucination filters;
- domain-vocabulary plausibility;
- transcript length relative to utterance duration.

### Rule

Avoid pretending confidences from unrelated model families are directly calibrated. Use coarse decision rules.

### Acceptance

Selection is deterministic and explained in diagnostics.

---

# 14. Phase 8 — Vocabulary and Context

## Goal

Improve names, terminology, and translation preservation without over-biasing recognition.

---

## DS-800 — Generalize glossary entries

### Entry shape

```typescript
type VocabularyEntry = {
  id: string;
  canonicalText: string;
  spokenVariants: string[];
  languages: string[];
  domains: string[];
  protectedInTranslation: boolean;
  preferredTranslation?: string;
  enabled: boolean;
};
```

### Compatibility

Adapt existing glossary data instead of deleting it.

### Acceptance

Old glossary entries migrate.

---

## DS-801 — Add vocabulary packs

### Initial packs

```text
valorant
general_technology
business_meeting
web3
```

Only VALORANT needs to ship in the first patch. Add other packs separately.

### Rules

- Packs are disabled unless selected by preset or user.
- Users can inspect enabled terms.
- Custom entries override pack entries where IDs conflict.

---

## DS-802 — Build bounded hotword set

### Rules

- Deduplicate terms.
- Prefer current-domain terms.
- Limit total characters/tokens.
- Exclude disabled entries.
- Exclude terms outside allowed languages unless intentionally cross-lingual.
- Log which terms were applied in advanced diagnostics.

### Acceptance

Tests prove General preset does not inherit VALORANT terms.

---

## DS-803 — Build recent-context manager

### Per-source state

- accepted final text;
- confidence category;
- detected language;
- completion timestamp.

### Add to context only when

- final;
- not suppressed;
- sufficiently confident;
- allowed language;
- not a hallucination;
- not excessive repetition.

### Reset on

- source stop;
- profile change;
- long silence;
- strong unexpected-language event;
- manual clear.

### Acceptance

Context never crosses source IDs.

---

## DS-804 — Preserve vocabulary through translation

### Goal

Ensure names and protected terms survive translation.

### Design

Use placeholders or structured preservation rather than a no-op string replacement.

### Required tests

- protected Latin term inside Chinese;
- protected Chinese name;
- repeated protected term;
- overlapping term names;
- translation provider failure;
- placeholder collision.

### Acceptance

Preservation is deterministic and reversible.

---

# 15. Phase 9 — History and Outputs

## Goal

Make the general product useful beyond a floating caption.

---

## DS-900 — Strengthen caption-history model

### Store

- source ID and snapshot;
- original text;
- translated text;
- start/end time;
- status;
- confidence category;
- selected provider;
- detected language;
- warnings;
- preset;
- session ID.

### Rules

- final replaces provisional in history;
- history size is bounded;
- retention is configurable;
- sensitive logs remain local.

---

## DS-901 — Add transcript export

### Formats

Implement one format per task:

1. TXT
2. JSON
3. SRT
4. VTT
5. Markdown

### Requirements

- explicit source labels;
- original-only, translation-only, or both;
- correct chronological ordering;
- stable timestamp conversion;
- UTF-8;
- no provisional captions.

---

## DS-902 — Add streaming output interface

### Initial interface

A local, documented output stream for caption consumers.

Possible supported form based on existing architecture:

- local WebSocket;
- local HTTP stream;
- OBS browser-source endpoint.

Choose one first. Do not implement all in one task.

### Requirements

- localhost by default;
- explicit opt-in;
- bounded clients;
- no raw audio;
- final/provisional status included;
- documented schema.

---

# 16. Phase 10 — Reliability and Release

## Goal

Make installation, recovery, upgrades, and clean-machine behavior predictable.

---

## DS-1000 — Clean-machine Windows matrix

Test:

- no CUDA toolkit;
- NVIDIA GPU with downloadable runtime;
- CPU-only;
- VB-CABLE absent;
- VB-CABLE installed before app;
- VB-CABLE installed while app is open;
- missing model;
- corrupt model;
- disconnected endpoint;
- renamed endpoint;
- multiple virtual cables.

Record exact results.

---

## DS-1001 — Clean-machine Apple Silicon matrix

Test:

- model installation;
- Metal-capable provider;
- virtual audio-device flow using the supported macOS equivalent;
- microphone flow;
- endpoint disconnection;
- export;
- overlay.

Keep platform-specific onboarding separate where device naming differs.

---

## DS-1002 — Recovery state audit

Every major failure needs:

```text
What happened
Likely cause
One primary recovery action
Advanced details
```

Audit:

- no input;
- missing cable;
- missing monitor device;
- model unavailable;
- model checksum failure;
- CUDA runtime failure;
- overload;
- translation failure;
- sidecar restart;
- endpoint disconnect.

---

## DS-1003 — Performance budgets

Define per quality profile and hardware class:

- maximum provisional cadence;
- target final latency;
- queue capacity;
- supported concurrent sources;
- maximum loaded models;
- memory budget.

Add warnings when the user selects a configuration outside the recommended class.

---

## DS-1004 — Documentation

Required documents:

```text
README.md
docs/QUICK_START.md
docs/VIRTUAL_CABLE_SETUP_WINDOWS.md
docs/VALORANT_SETUP.md
docs/DISCORD_SETUP.md
docs/MEETING_SETUP.md
docs/MODELS_AND_QUALITY.md
docs/TROUBLESHOOTING_AUDIO.md
docs/PRIVACY.md
```

Documentation must match current UI labels exactly.

---

## DS-1005 — v1.0 release gate

Release only when:

- no known wrong-language silent fallback remains;
- normal supported load has zero raw-audio packet loss;
- a first-time Windows tester completes VB-CABLE setup without external help;
- saved profiles recover from endpoint changes;
- final captions cannot be overwritten by stale provisional captions;
- General preset contains no VALORANT-only vocabulary;
- benchmark results are recorded by language and condition;
- clean-machine installation passes;
- all canonical test commands pass;
- documentation is current.

---

# 17. Commit Strategy

Use one commit per task.

Examples:

```text
test(language): cover general source profile routing
fix(language): remove unrelated profile fallback
test(asr): cover joint no-speech filtering
fix(asr): preserve confident high-no-speech segments
feat(audio): expose per-source health metrics
feat(setup): detect virtual cable endpoints
feat(setup): add routing wizard state machine
feat(presets): add general conversation preset
feat(asr): separate provisional and final recognition
```

Do not combine unrelated fixes to reduce commit count.

---

# 18. DeepSeek Task Packet Template

Copy this for every task.

```markdown
# Task <ID>: <Title>

## Goal

<One observable behavioral change.>

## Repository context

Read first:

- `docs/GENERALIZATION_CONTEXT.md`
- `docs/GENERALIZATION_DECISIONS.md`
- `<specific files>`

## Current expected behavior

<Describe the current implementation and known defect.>

## Required behavior

1. ...
2. ...
3. ...

## Allowed production files

- `path/a`
- `path/b`

## Allowed test files

- `path/test_a`
- `path/test_b`

## Forbidden changes

- No unrelated refactors.
- No new dependencies.
- No provider removals.
- No UI redesign.
- No protocol-version bump unless explicitly requested.

## Invariants

- ...
- ...

## Tests to add first

1. ...
2. ...

## Verification

Run the canonical focused commands from `docs/GENERALIZATION_CONTEXT.md`.

Then run the relevant regression commands.

## Acceptance criteria

- [ ] ...
- [ ] ...
- [ ] ...

## Stop conditions

Stop and report without coding if:

- ...
- ...

## Required final response

1. Current behavior found
2. Minimal approach
3. Files changed
4. Tests
5. Commands and results
6. Risks
```

---

# 19. Master Prompt for DeepSeek Flash

Use this at the start of each implementation conversation.

```text
You are implementing one bounded task in the yTSRL repository.

The product is being generalized from a VALORANT-first translator into a
general-purpose real-time subtitle and translation application. VALORANT
must remain available as a preset, but game-specific assumptions must not
leak into General Conversation behavior.

You must follow these rules:

1. Read docs/GENERALIZATION_CONTEXT.md and
   docs/GENERALIZATION_DECISIONS.md first.
2. Work only on the task provided.
3. Inspect the current code before proposing changes.
4. Do not guess file contents or APIs.
5. Add or update focused tests before or with implementation.
6. Modify only allowed files.
7. Do not add dependencies unless explicitly allowed.
8. Do not perform unrelated refactors, formatting, or renames.
9. Preserve backward compatibility where the task requires it.
10. Run the repository's existing canonical verification commands.
11. If an assumption is wrong or scope expands materially, stop and report it.
12. Do not continue to another task after finishing.

Return:
- current behavior found;
- minimal implementation plan;
- exact files changed;
- tests added;
- commands run and results;
- remaining risks.
```

---

# 20. Review Prompt for DeepSeek

Use a separate session after a patch is produced.

```text
Review the patch for task <ID> as a strict maintainer.

Do not rewrite the patch yet.

Check:
1. Does it satisfy every acceptance criterion?
2. Did it modify forbidden or unrelated behavior?
3. Are protocol and persisted-settings compatibility preserved?
4. Are tests meaningful, or do they only mirror implementation?
5. Can raw audio, final captions, source IDs, or language hints be lost?
6. Are errors recoverable and visible?
7. Are concurrency and lifecycle rules safe?
8. Are there missing edge cases?
9. Did the patch add a dependency or hidden global state?
10. Is the patch small enough for one task?

Return:
- blockers;
- important issues;
- minor issues;
- missing tests;
- approve or reject.
```

---

# 21. Bug-Fix Prompt

```text
The previous patch failed with the exact output below.

Do not redesign the feature.
Do not modify new files unless the failure proves they are required.
Identify the smallest root cause and patch only that cause.
Preserve all task acceptance criteria.

Task: <ID>
Command: <exact command>
Output:
<exact output>

Return:
1. Root cause
2. Minimal change
3. Patch
4. Re-run result
5. Any new risk
```

---

# 22. Phase Completion Checklist

At the end of every phase:

```markdown
- [ ] Every task has one reviewed commit.
- [ ] Canonical focused tests pass.
- [ ] Full relevant regression tests pass.
- [ ] Context document lists completed tasks.
- [ ] Decision document contains new architectural decisions.
- [ ] No temporary debug output remains.
- [ ] No private audio is committed.
- [ ] Settings migration is tested where applicable.
- [ ] User-visible copy matches actual behavior.
- [ ] The next phase's preconditions are satisfied.
```

---

# 23. Recommended First Execution Sequence

Do not start with the wizard or new models. Use this exact order:

```text
DS-000  Create branch
DS-001  Discover test commands
DS-002  Inventory behavior
DS-003  Benchmark schema

DS-100  Language-routing regression tests
DS-101  Language-routing fix
DS-102  Segment-filter tests
DS-103  Segment-filter fix
DS-104  Audio-loss instrumentation
DS-105  Audio-loss prevention

DS-200  Source origin
DS-201  LanguageConfig
DS-202  Domain preset catalog
DS-203  Quality profiles
DS-204  Settings migration

DS-300  Audio health metrics
DS-301  Health states
DS-302  Light normalization
DS-303  Source-origin policies

DS-400  VAD profiles
DS-401  Segmentation diagnostics
DS-402  Recommendations

DS-500–DS-509  VB-CABLE guided setup

DS-600–DS-606  Presets and clean UI

DS-700–DS-709  Recognition router and final quality

DS-800–DS-804  Vocabulary and context

DS-900–DS-902  History, export, and streaming output

DS-1000–DS-1005  Clean-machine QA and release
```

The sequence matters. A setup wizard built before stable source schemas will be rewritten. Model comparisons made before language routing and audio continuity are corrected will be misleading.

---

# 24. Definition of “Generally Working Great”

The project is ready to be described as general-purpose only when:

1. A source is not tied to a game-specific concept.
2. Known language choices reach providers correctly.
3. Automatic language behavior never becomes an unrelated forced language.
4. Virtual-cable audio can be configured through a guided flow.
5. The user can verify voice signal and isolation before starting.
6. Normal supported operation does not discard raw audio.
7. VAD behavior adapts to callouts, conversations, and meetings.
8. Final captions are more authoritative than provisional captions.
9. General mode does not inherit game vocabulary.
10. Technical provider choices are optional advanced controls.
11. Every failure includes a recovery path.
12. Accuracy is measured on real routed-audio conditions.
13. Saved profiles survive restarts and endpoint changes.
14. Windows and Apple Silicon clean-machine tests pass.
15. All outputs remain subtitle- and transcript-focused.
