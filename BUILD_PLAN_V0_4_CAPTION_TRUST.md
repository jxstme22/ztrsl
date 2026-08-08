# xTRSNLTR v0.4.0 Build Plan

## Caption Accuracy, Overlap Awareness, and Trust

**Depends on:** v0.3 multi-source audio  
**Primary question:** Can users trust the caption shown on screen?

## 1. Context

v0.3 should already provide:

- multiple separated audio sources;
- VB-CABLE as an external routing option;
- editable source names and tags;
- source-aware captions such as `[TEAM]` and `[DISCORD]`;
- per-source language profiles and strictness;
- shared ASR/translation scheduling.

Correct routing keeps VALORANT game audio outside ASR:

```text
VALORANT voice → VB-CABLE → xTRSNLTR
VALORANT game/announcer → headphones only
```

Therefore v0.4 does not focus on game-noise classification. It focuses on difficult speech inside a valid source:

- multiple people speaking inside one source;
- wrong tactical terms;
- wrong numbers, direction, site, or negation;
- short ambiguous callouts;
- incorrect language handling;
- simultaneous TEAM and DISCORD speech;
- uncertain output presented too confidently.

## 2. Goals

1. Detect and handle overlapping speech per source.
2. Add trustworthy uncertainty and suppression states.
3. Make Off/Balanced/Strict language behavior real.
4. Add per-source phrase filters.
5. Add editable glossary and ASR corrections.
6. Expand Clip Lab into Accuracy Lab.
7. Compare installed ASR/translation combinations.
8. Improve scheduler behavior under simultaneous speech.
9. Preserve local-only processing and all game-safety boundaries.

## 3. Non-goals

- Game memory access or graphics hooks.
- Player identity.
- Full speech separation.
- Cloud ASR/translation.
- Heavy VALORANT game-sound classification.
- Custom audio driver.

## 4. Caption certainty

```rust
pub enum CaptionCertainty {
    Normal,
    Uncertain { reasons: Vec<UncertaintyReason> },
    Suppressed { reason: SuppressionReason },
}

pub enum UncertaintyReason {
    OverlappingSpeech,
    LowAsrConfidence,
    UnexpectedLanguage,
    AudioClipping,
    SegmentTooShort,
    TranslationInstability,
}
```

Overlay examples:

```text
[TEAM] Rotate B!
[TEAM?] Possibly two at B main.
[TEAM] Multiple speakers
```

Requirements:

- certainty travels through Python/Rust IPC;
- final captions remain terminal;
- no fake confidence percentages;
- suppressed content does not appear briefly before removal.

## 5. Overlap policy

```rust
pub enum OverlapPolicy {
    ProcessNormally,
    MarkUncertain,
    SuppressHeavyOverlap,
}
```

Recommended defaults:

```yaml
TEAM:
  overlap_policy: suppress_heavy_overlap
DISCORD:
  overlap_policy: mark_uncertain
```

Pipeline:

```text
source audio → VAD → overlap detector → policy → ASR or suppression
```

Initial calibration values:

```yaml
mild_overlap_ratio: 0.15
heavy_overlap_ratio: 0.40
minimum_overlap_ms: 250
```

These are tunable defaults, not permanent thresholds.

## 6. Language strictness

```rust
pub enum LanguageStrictness {
    Off,
    Balanced,
    Strict,
}
```

**Off**

- no rejection;
- process whatever is recognized.

**Balanced**

- prefer configured languages;
- permit known English tactical terms;
- reject clearly unrelated languages;
- preserve short callouts.

**Strict**

- force ASR language when supported;
- reject unexpected languages;
- use profile-specific glossary;
- require stronger display confidence.

Example:

```yaml
source: TEAM
profile: taglish
strictness: balanced
allowed_languages: [fil, en]
allow_tactical_terms: true
```

Very short terms such as `B`, `left`, `two`, `go`, and `mid` bypass unreliable language identification.

## 7. Phrase filters

Per-source rule:

```json
{
  "source_id": "source_discord_01",
  "text": "user joined your channel",
  "match_mode": "similar",
  "threshold": 0.87,
  "enabled": true
}
```

Modes:

```rust
pub enum PhraseMatchMode {
    Exact,
    Contains,
    Similar,
    Regex,
}
```

Processing order:

```text
ASR → normalize → phrase filters → language gate
→ glossary correction → translation → overlay
```

Phrase filters are a fallback/customization feature, not the main solution for VALORANT game audio.

## 8. Glossary and corrections

```rust
pub enum GlossaryEntryType {
    Preserve,
    AsrCorrection,
    PreferredTranslation,
    Alias,
}
```

Examples:

```text
bind men → B main
Jett → preserve exactly
umiikot → rotating
```

Scopes:

- global;
- source;
- language profile;
- model;
- preset.

Requirements:

- hot reload without model restart;
- Unicode;
- import/export;
- conflict warning;
- protected placeholders survive translation;
- size and regex limits.

## 9. Accuracy Lab

Expand the existing Clip Lab to:

- run one clip through multiple installed configurations;
- compare source transcript and English translation;
- report ASR, MT, and total latency;
- record model ID, revision, runtime, and checksum;
- annotate errors;
- export JSON and Markdown.

Configurations might include:

```text
Whisper Turbo + NLLB
Whisper Turbo + MADLAD
Omnilingual 300M + MADLAD
Omnilingual 1B + MADLAD
```

Error taxonomy:

```text
Correct
Mostly correct
Wrong language
Wrong number
Wrong site
Wrong direction
Negation reversed
Term corrupted
Hallucination
Speech omitted
Overlap failure
```

Audio stays local. Reports exclude transcript/audio content by default.

## 10. Model recommendations

Inputs:

- source language profile;
- strictness;
- CPU/GPU/VRAM;
- installed runtimes;
- resource policy;
- local Accuracy Lab results;
- model capability and license.

Recommendations are optional and explainable. Never install or switch automatically.

## 11. Adaptive scheduling

```rust
pub enum ResourcePolicy {
    MaximumAccuracy,
    Balanced,
    ProtectGamePerformance,
}
```

| State         | TEAM                | DISCORD                |
| ------------- | ------------------- | ---------------------- |
| Normal        | provisional + final | provisional + final    |
| Both speaking | provisional + final | final only             |
| High pressure | final only          | final only             |
| Overload      | preserve final      | drop stale provisional |

No game memory or hidden state is used.

## 12. Architecture additions

```text
services/inference/
├── overlap/
├── language_gate/
├── phrase_filters/
├── glossary/
├── certainty/
└── evaluation/

apps/desktop/src/features/
├── accuracy-lab/
├── glossary/
├── phrase-filters/
├── certainty/
└── model-recommendations/
```

Caption IPC additions:

```json
{
  "certainty": "uncertain",
  "uncertainty_reasons": ["overlapping_speech"],
  "selected_profile": "taglish",
  "strictness": "balanced",
  "detected_language": "fil",
  "language_accepted": true,
  "matched_filter_id": null
}
```

# 13. Build Phases

## Phase 0 — Freeze baseline

- Commit v0.3 fixtures.
- Record latency/resource baseline.
- Define critical tactical error taxonomy.
- Add feature flags.

**Acceptance:** reproducible baseline report exists.

## Phase 1 — Accuracy Lab

- Multi-configuration execution.
- Error labels.
- Machine-readable reports.
- Exact runtime/model metadata.

**Acceptance:** same clip comparison is reproducible.

## Phase 2 — Language strictness

- Off/Balanced/Strict.
- Forced language where supported.
- Language gate.
- Tactical short-term bypass.
- Provider limitations UI.

**Acceptance:** profile selection changes real processing behavior.

## Phase 3 — Phrase filters

- Exact/contains/similar/regex.
- Per-source scope.
- Rule preview.
- Import/export.
- Diagnostics.

**Acceptance:** filtered phrases never reach MT or overlay.

## Phase 4 — Glossary editor

- Preserve, ASR correction, preferred translation, aliases.
- Scopes.
- Hot reload.
- Import/export.

**Acceptance:** corrections work without large-model restart.

## Phase 5 — Certainty states

- IPC schema.
- State reducer.
- Overlay rendering.
- Suppressed reasons.
- Final-state behavior.

**Acceptance:** uncertain output is visibly distinct.

## Phase 6 — Overlap detection

- Per-source detector.
- Mild/heavy policies.
- Fixture set.
- Metrics.

**Acceptance:** heavy overlap is not confidently captioned by default.

## Phase 7 — Adaptive scheduler

- Resource policies.
- Provisional throttling.
- TEAM priority.
- Overload behavior.

**Acceptance:** final jobs survive and queues stay bounded.

## Phase 8 — Recommendations and validation

- Hardware compatibility.
- Benchmark-informed suggestions.
- Real-session matrix.
- v0.4 validation document.

**Acceptance:** release checklist passes.

# 14. Release Criteria

- [ ] Language strictness affects inference.
- [ ] Short tactical callouts are protected.
- [ ] Phrase filters are source-scoped.
- [ ] Glossary hot reload works.
- [ ] Accuracy Lab compares installed configurations.
- [ ] Certainty is represented end to end.
- [ ] Heavy overlap is suppressed or marked uncertain.
- [ ] TEAM remains prioritized under pressure.
- [ ] No unbounded queues.
- [ ] No cloud audio or default content persistence.
- [ ] No game-process access.
- [ ] Rust, TypeScript, and Python checks pass.

# 15. Codex Prompt

```text
Read AGENTS.md, README.md, the v0.3 specification, and this file.

Implement v0.4 phase by phase. Do not add game hooks, cloud audio, or heavy
game-noise classification. VB-CABLE routing remains the main isolation method.

For each phase:
1. restate acceptance criteria;
2. implement a complete vertical slice;
3. add tests;
4. run format/lint/typecheck/test;
5. update documentation;
6. report evidence and remaining risks.
```
