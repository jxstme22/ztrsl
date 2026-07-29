# Product Requirements Document

## 1. Product Name

Working name: **Local Squad Translator**

The shipped name must not imply endorsement by Riot Games and must not use protected branding in a confusing way.

## 2. Problem

A player joins VALORANT voice chat with friends who frequently speak Tagalog/Filipino, Cebuano, English, Taglish, or Bislish. The player cannot reliably understand the non-English parts while actively playing.

Existing general live-caption tools may:

- capture all desktop audio;
- lack Cebuano support;
- require cloud processing;
- introduce unstable word-by-word translation;
- lack game-safe overlays;
- consume too many GPU resources;
- provide no terminology handling for tactical speech.

## 3. Objective

Build a fully local Windows application that captures a dedicated voice-chat audio endpoint, recognizes supported speech, translates it into English, and renders low-latency subtitles over VALORANT without interacting with the game process.

## 4. Personas

### Primary

A Windows player with:

- Windows 11;
- an NVIDIA RTX 4070 Ti-class GPU;
- headphones;
- friends using Tagalog/Cebuano in voice chat;
- willingness to install a signed virtual audio cable;
- preference for local privacy.

### Secondary

- Players with lower GPUs who can use smaller models or CPU fallback.
- Users wanting live subtitles for other voice applications later.

## 5. Core User Journey

1. Install the desktop app.
2. Complete first-run model setup.
3. Install or select a virtual audio cable.
4. Set VALORANT Voice Chat Output Device to the cable input.
5. In the app, select the cable capture endpoint.
6. Select physical headphone playback.
7. Run a routing test.
8. Choose:
   - Tagalog/Taglish;
   - Cebuano/Bislish;
   - Auto mixed.
9. Launch or focus VALORANT in Borderless Windowed mode.
10. Toggle overlay.
11. Hear friends normally and see English subtitles.
12. Exit; no raw audio remains unless diagnostic recording was enabled.

## 6. Functional Requirements

### FR-001 Audio Device Enumeration

The application MUST list active Windows input and output endpoints with:

- stable endpoint identifier;
- friendly name;
- state;
- sample rate if available;
- channel count if available;
- default role indicators.

It MUST handle endpoints appearing or disappearing while running.

### FR-002 Dedicated Voice Capture

The user MUST be able to select the virtual cable endpoint carrying voice chat.

The application MUST reject selecting the same logical endpoint for a configuration that creates an obvious feedback loop.

### FR-003 Audio Monitoring

The captured voice MUST be forwarded to the selected physical headphones.

Monitoring MUST:

- be independently toggleable;
- expose volume;
- expose latency status;
- avoid feedback;
- recover from endpoint resets.

### FR-004 Resampling and Downmix

The inference feed MUST be normalized to:

- 16,000 Hz;
- mono;
- float32 or PCM16 as required;
- bounded amplitude;
- no clipping introduced by the app.

Playback monitoring SHOULD remain in the endpoint's native format where practical.

### FR-005 Voice Activity Detection

The system MUST detect speech boundaries and output utterance events containing:

- start monotonic timestamp;
- end monotonic timestamp;
- audio samples;
- confidence/score summary;
- forced-end flag for maximum duration.

The VAD MUST support configurable:

- speech threshold;
- minimum speech;
- pre-roll;
- hangover silence;
- maximum utterance duration.

### FR-006 ASR

The application MUST support explicit source modes:

- Filipino/Tagalog;
- Cebuano;
- mixed/auto.

ASR results MUST include:

- text;
- source language mode;
- utterance ID;
- provisional/final status;
- processing duration;
- model identifier;
- confidence where available.

### FR-007 Translation

The application MUST translate non-English source text into English.

It MUST preserve configured protected terms, including agent names, map calls, weapons, and common English tactical vocabulary.

It MUST not translate text already judged to be entirely English unless the user enables English cleanup.

### FR-008 Subtitle Lifecycle

Each subtitle MUST have a stable ID and one of:

- provisional;
- final;
- replaced;
- expired;
- error.

A final subtitle MUST not be silently rewritten after its correction window closes.

### FR-009 Overlay

The overlay MUST:

- be transparent;
- be topmost when enabled;
- be click-through in play mode;
- never activate or focus on caption update;
- support one or two text lines;
- support multi-monitor positioning;
- support scaling;
- expose a setup/edit mode.

### FR-010 Global Hotkeys

At minimum:

- toggle overlay;
- toggle translation;
- enter/exit overlay edit mode;
- clear current captions;
- increase/decrease subtitle size.

Hotkeys MUST be configurable and conflict-aware.

### FR-011 Settings

Settings MUST include:

- source mode;
- capture endpoint;
- playback endpoint;
- monitoring volume;
- overlay monitor and normalized position;
- font size;
- source transcript visibility;
- caption duration;
- model choice;
- resource mode;
- privacy/history options.

### FR-012 Diagnostics

The app MUST expose:

- device status;
- capture level;
- VAD state;
- queue depths;
- ASR duration;
- translation duration;
- end-to-end caption latency;
- CPU;
- app GPU/VRAM where measurable;
- dropped audio frames;
- inference errors.

### FR-013 Model Manager

The application MUST:

- show required model size before download;
- download over HTTPS;
- verify checksums;
- store source/license metadata;
- support pause/resume or safe retry;
- reject corrupted models;
- allow model removal;
- avoid bundling models in the installer unless redistribution terms are explicitly approved.

### FR-014 Privacy

Default behavior:

- no cloud calls;
- no raw audio files;
- no transcript history;
- no telemetry;
- ephemeral in-memory processing.

Optional history or diagnostics MUST be explicit and revocable.

### FR-015 Graceful Failure

The user MUST receive a clear action when:

- the selected endpoint disappears;
- no audio is received;
- the model is missing;
- the sidecar fails;
- CUDA is unavailable;
- GPU memory is exhausted;
- the overlay cannot appear above the selected display mode;
- IPC authentication fails.

## 7. Non-Functional Requirements

### NFR-001 Latency Budgets

Initial target budgets, measured from capture timestamp:

| Event | p50 target | p95 target |
|---|---:|---:|
| Audio capture to VAD observation | 100 ms | 200 ms |
| First useful provisional source text | 900 ms | 1,500 ms |
| First useful provisional English | 1,300 ms | 2,200 ms |
| Final English after end of speech | 1,200 ms | 2,500 ms |
| Overlay update after result received | 16 ms | 50 ms |

Targets are development goals, not promises.

### NFR-002 Gameplay Resource Budget

While VALORANT is running:

- idle translator GPU usage SHOULD be near zero;
- inference MUST use batch size 1;
- queues MUST be bounded;
- the application SHOULD stay below 5 GB VRAM in the default model profile;
- the application MUST expose a low-resource profile;
- no sustained frame-time degradation greater than the configured acceptance threshold.

### NFR-003 Reliability

- No process crash after endpoint disconnect/reconnect.
- No unbounded memory growth in a two-hour soak test.
- No audio callback blocking beyond its period.
- Sidecar restarts must be controlled and rate-limited.
- Settings migrations must be versioned.

### NFR-004 Security

- Bind IPC to loopback only.
- Generate a random session token for every launch.
- Validate every message and enforce size limits.
- Do not expose inference service to the LAN.
- Do not execute model-provided code.
- Prefer safetensors/ONNX over pickle-like formats.

### NFR-005 Accessibility

- Resizable text.
- High-contrast background.
- Position presets.
- Optional source line.
- Reduced-motion mode.
- Keyboard-accessible settings.
- Screen-reader labels in the control window.

## 8. Quality Requirements

The team MUST build a consented native-speaker evaluation set containing:

- formal Tagalog;
- casual Tagalog;
- Cebuano from multiple regional speakers;
- Taglish;
- Bislish;
- tactical callouts;
- numeric callouts;
- names;
- noisy game-like backgrounds;
- different microphones;
- fast speech;
- clipped speech;
- silence and non-speech.

Track:

- CER/WER;
- named-term accuracy;
- semantic translation score by human review;
- critical tactical meaning errors;
- subtitle delay;
- revision rate;
- dropped utterance rate.

## 9. Out of Scope

See root README. Additionally:

- automatic voice-to-player mapping;
- translation into more languages;
- speech synthesis;
- cloud fallback;
- mobile support;
- macOS support;
- competitive analytics;
- recording other players without appropriate notice or consent.

## 10. Release Gates

### Personal Alpha

- All processing local.
- Works with recorded fixtures and one live call.
- Overlay works in Borderless Windowed.
- No game hooks.
- Manual model installation acceptable.

### Private Beta

- First-run setup.
- Model manager.
- Signed installer.
- Native-speaker benchmark.
- Two-hour soak test.
- Recovery from device changes.

### Public Release

- Riot product registration/policy review as applicable.
- Legal review for model and virtual-cable redistribution.
- Privacy policy.
- Crash reporting opt-in only.
- Installer signing.
- Support and update process.
