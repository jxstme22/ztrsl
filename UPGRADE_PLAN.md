# yTSRL General-Purpose Upgrade Plan

## 1. Product Goal

Transform yTSRL from a VALORANT-focused voice translator into a clean, reliable, general-purpose real-time subtitle and translation application for:

* Games and in-game voice chat
* Discord and other voice platforms
* Meetings and video calls
* General conversations
* Livestreaming and OBS
* Language learning
* Accessibility

VALORANT should remain a first-class optimized preset, but it should no longer define the internal architecture.

### Product positioning

> Real-time local subtitles and translation for games, calls, meetings, and everyday conversations.

Core principles:

1. Simple enough for non-technical users.
2. Local-first and privacy-conscious.
3. Clean audio routing through virtual audio devices.
4. Fast provisional captions with more accurate final captions.
5. Technical settings hidden unless the user opens Advanced Mode.
6. Every source has its own audio, language, model, and display configuration.

---

# 2. Current Foundation

The project already has important reusable foundations:

* Multi-source audio capture
* Independent per-source VAD state
* Source labels and presentation metadata
* Whisper, SenseVoice, Paraformer, and other ASR providers
* Translation providers
* Shared inference scheduling
* Transparent overlay
* Per-source glossary and phrase filtering
* Provisional and final captions
* Windows and Apple Silicon support

The current live pipeline already manages independent source state, VAD segmentation, inference, glossary processing, translation, and final caption delivery.

The upgrade should extend this architecture instead of replacing it.

---

# 3. Target User Experience

The normal user flow should become:

```text
Open yTSRL
    ↓
Choose a use case
    ↓
Choose the application or audio source
    ↓
Complete guided audio routing
    ↓
Select spoken and translated languages
    ↓
Run a short audio test
    ↓
Start captions
```

Recommended first-screen options:

```text
Gaming
Voice Call
Meeting
General Conversation
Streaming
Language Learning
```

Users should not initially see technical model names such as:

```text
whisper-large-v3
sensevoice-small
paraformer-zh-streaming
ncspeech-zh-parakeet
```

They should see:

```text
Fast
Balanced
Best Quality
Low Memory
```

Technical model selection remains available under Advanced Settings.

---

# 4. Phase 0 — Correctness and Stability

This phase must be completed before adding major features.

## 4.1 Fix language-profile routing

The current sidecar recognizes the literal profile `"chinese"` but the desktop uses profile identifiers such as `"mandarin"` and `"chinese_english"`. Unrecognized profiles currently fall back to Filipino mode.

Replace hardcoded fallback behavior with an explicit language configuration.

```python
@dataclass(frozen=True)
class LanguageConfig:
    primary_language: str | None
    secondary_languages: tuple[str, ...]
    detection_mode: str
```

Supported detection modes:

```text
fixed
primary_preferred
limited_auto
full_auto
```

Examples:

```json
{
  "primary_language": "zh",
  "secondary_languages": [],
  "detection_mode": "fixed"
}
```

```json
{
  "primary_language": "zh",
  "secondary_languages": ["en"],
  "detection_mode": "primary_preferred"
}
```

Never silently fall back to Filipino or another unrelated language.

## 4.2 Stop dropping raw audio

Raw audio packets should not use latest-wins behavior.

Correct priority:

```text
Raw audio: never intentionally drop
Final ASR: never intentionally drop
Translation: preserve final jobs
Provisional ASR: may coalesce or drop
UI preview: may skip stale revisions
```

Introduce a short bounded audio ring buffer, preferably five to ten seconds per source.

When overload occurs:

1. Drop stale provisional inference jobs.
2. Reduce provisional update frequency.
3. Temporarily switch to final-only captions.
4. Show a visible performance warning.
5. Never hide dropped-audio metrics.

## 4.3 Correct non-speech filtering

Do not reject a Whisper segment only because `no_speech_prob` is high.

Use a combined decision involving:

* `no_speech_prob`
* `avg_logprob`
* transcript length
* VAD speech confidence

One-word callouts and quiet Mandarin phrases should not be discarded automatically.

## 4.4 Create a baseline test set

Before changing more models, save real audio from:

* VB-CABLE routed voice chat
* Discord calls
* Meetings
* Mandarin conversation
* Mandarin-English code-switching
* English conversation
* Quiet microphones
* Low-quality remote microphones

Store:

```json
{
  "audio": "sample_001.wav",
  "reference": "他们两个在B点后面",
  "language": "zh",
  "domain": "gaming",
  "source_type": "virtual_voice_channel",
  "noise_level": "low",
  "overlap": false
}
```

Measure:

* Character error rate for Chinese
* Word error rate for Latin-script languages
* Missing beginning rate
* Missing ending rate
* Hallucination rate
* Final-caption latency
* Dropped-audio count

---

# 5. Phase 1 — General Source Architecture

## 5.1 Introduce source origins

Each source should declare where its audio comes from.

```text
Virtual voice channel
Physical microphone
Application audio
System mix
Recorded file
```

Example:

```json
{
  "name": "VALORANT Team Voice",
  "source_origin": "virtual_voice_channel",
  "capture_endpoint": "CABLE Output",
  "monitor_endpoint": "Headphones",
  "primary_language": "zh",
  "secondary_languages": ["en"],
  "preset": "valorant",
  "priority": 100
}
```

The source origin determines default audio processing.

### Virtual voice channel

```text
Noise suppression: Off
Echo cancellation: Off
Gain normalization: Off or light
VAD: On
```

### Physical microphone

```text
Noise suppression: Optional
Echo cancellation: Optional
Gain normalization: Light
VAD: On
```

### System mix

```text
Speech enhancement: Optional
Stronger non-speech filtering
VAD: On
```

VB-CABLE provides isolated application or voice-channel audio. It does not guarantee that remote users have clean microphones, but it removes local game audio from the recognition pipeline.

## 5.2 Replace domain assumptions with presets

Create a general preset system.

```python
@dataclass(frozen=True)
class DomainPreset:
    id: str
    display_name: str
    vad_profile: str
    caption_profile: str
    latency_profile: str
    glossary_pack: str | None
    hotword_pack: str | None
    overlap_policy: str
    context_policy: str
```

Initial presets:

```text
General Conversation
VALORANT
Gaming
Discord
Meeting
Streaming
Language Learning
Accessibility
```

Example VALORANT preset:

```json
{
  "id": "valorant",
  "vad_profile": "fast_callouts",
  "caption_profile": "compact",
  "latency_profile": "realtime",
  "glossary_pack": "valorant",
  "hotword_pack": "valorant",
  "overlap_policy": "mark_uncertain",
  "context_policy": "short"
}
```

Example meeting preset:

```json
{
  "id": "meeting",
  "vad_profile": "natural_speech",
  "caption_profile": "full_sentences",
  "latency_profile": "balanced",
  "glossary_pack": null,
  "hotword_pack": null,
  "overlap_policy": "process_normally",
  "context_policy": "conversation"
}
```

---

# 6. Phase 2 — VB-CABLE Setup Experience

VB-CABLE should be presented as a recommended guided setup, not as an external technical requirement users must understand alone.

## 6.1 Setup wizard structure

The wizard should contain these steps:

```text
1. Choose application
2. Detect virtual cable
3. Route application audio
4. Select monitoring device
5. Test voice signal
6. Test audio isolation
7. Save source profile
```

## 6.2 Step 1: Choose an application

Provide cards:

```text
VALORANT
Discord
Zoom
Microsoft Teams
Browser meeting
Other application
```

Each card should load a tailored guide.

## 6.3 Step 2: Detect VB-CABLE

Enumerate Windows playback and recording endpoints.

Recognize likely names such as:

```text
CABLE Input
CABLE Output
VB-Audio Virtual Cable
```

Possible states:

### Detected

> VB-CABLE is ready.

### Not detected

> Virtual audio cable not found.

Show:

```text
Install VB-CABLE
Refresh devices
Use a physical microphone instead
```

After installation, the user should only need to click **Refresh Devices** rather than restart the entire setup.

## 6.4 Step 3: Explain routing clearly

Use a visual routing diagram:

```text
Application voice output
        ↓
CABLE Input
        ↓
CABLE Output
        ↓
yTSRL
        ↓
Headphones
```

Explain the confusing device naming directly:

```text
Choose “CABLE Input” inside the application.
Choose “CABLE Output” inside yTSRL.
```

For VALORANT:

```text
VALORANT Game Output → Headphones
VALORANT Voice Chat Output → CABLE Input
yTSRL Capture Source → CABLE Output
yTSRL Monitoring Output → Headphones
```

This is the ideal route because game effects remain on the headphones while only team voice reaches STT.

For Discord or meeting applications:

```text
Application Output → CABLE Input
yTSRL Capture → CABLE Output
yTSRL Monitoring → Headphones
```

For applications without their own output selector, instruct the user to use Windows per-application audio output routing.

## 6.5 Step 4: Monitoring setup

yTSRL should forward captured voice audio to the user’s headphones.

Prevent common problems:

* Capture and monitoring endpoint are the same device.
* Monitoring output points back into VB-CABLE.
* A feedback loop is detected.
* Monitoring is enabled twice.
* The source is silent because the wrong cable side was selected.

Display:

```text
Capture: CABLE Output
Listen through: Headphones
```

Add an obvious **Mute Monitoring** toggle.

## 6.6 Step 5: Voice-signal test

Display a live level meter.

Instruction:

> Ask someone to speak, play a voice test, or join a voice channel.

Success condition:

```text
Voice detected
Signal level healthy
No clipping
VAD responding
```

Failure messages should be actionable:

```text
No signal detected
The application may not be routed to CABLE Input.
```

```text
Signal is very quiet
Increase the application’s output volume.
```

```text
Signal is clipping
Lower the application’s output volume.
```

## 6.7 Step 6: Isolation test

Instruction:

> Play game audio, music, or a video while nobody is speaking.

Expected result:

```text
The routed voice meter should remain silent or nearly silent.
```

Then:

> Play or receive speech through the selected application.

Expected result:

```text
The meter should become active.
```

Wizard result:

```text
Voice isolation passed
```

or:

```text
Non-voice audio detected
Check whether the application’s full output, rather than only voice chat, is routed to VB-CABLE.
```

## 6.8 Step 7: Save reusable profile

Example:

```text
Profile name: VALORANT Team
Application: VALORANT
Capture: CABLE Output
Monitor: Headphones
Spoken language: Mandarin + English
Preset: VALORANT
Quality: Balanced
```

The next session should start with one click.

## 6.9 Setup recovery tools

Add a **Fix Audio Setup** screen containing:

```text
Refresh audio devices
Test capture
Test monitoring
Swap cable input/output
Reset routing profile
Open Windows audio settings
Show routing diagram
```

Do not force users to delete and recreate the source when a device changes.

---

# 7. Phase 3 — Recognition Quality

## 7.1 Two-stage recognition

Use different models for provisional and final captions.

```text
Audio stream
    ├── Fast recognizer → provisional caption
    └── Completed utterance → quality recognizer → final caption
```

Possible configuration:

```text
Provisional Mandarin:
Streaming Paraformer or SenseVoice

Final Mandarin:
Higher-quality Mandarin/code-switching model

Final multilingual:
Whisper large-v3 or another strong multilingual model
```

The current Paraformer provider processes complete VAD utterances through a streaming recognizer rather than maintaining continuous streaming state.

Refactor it into one of these roles:

1. True continuous streaming provisional provider, or
2. Fast final provider for short utterances.

Do not present it as true streaming unless decoder state is maintained across chunks.

## 7.2 Quality profiles

### Fast

```text
One lightweight model
Frequent provisional captions
Greedy or small-beam decoding
Lowest latency
```

### Balanced

```text
Fast provisional model
Accurate final model
Limited context
Confidence fallback
```

### Best Quality

```text
Accurate final model
Larger decoding beam
Contextual vocabulary
Fallback second decode
Higher latency
```

## 7.3 Confidence-based fallback

When the first final result is uncertain:

```text
Low confidence
Unexpected language
Very short unclear result
High VAD speech confidence but empty transcript
Unusually high deletion probability
```

Run a second provider.

Example:

```text
Primary: Chinese-focused model
Fallback: Whisper large-v3
```

Select the result using:

* Provider confidence
* Language match
* Domain vocabulary match
* Transcript completeness
* Repetition and hallucination checks

## 7.4 Context without drift

Keep a short context buffer containing only:

* Final captions
* High-confidence captions
* Recent captions from the same source
* Captions in an expected language

Reset context after:

* Long silence
* Source restart
* Strong language change
* Repeated hallucination
* User request

Never feed provisional or low-confidence text back into ASR prompts.

## 7.5 Hotwords and custom vocabulary

Create vocabulary categories:

```text
Names
Places
Games
Companies
Products
Technical terms
Acronyms
Custom phrases
```

Each term can contain:

```json
{
  "canonical_text": "Qwen",
  "spoken_variants": ["queue wen", "qu wen"],
  "languages": ["en", "zh"],
  "protected_in_translation": true
}
```

Apply vocabulary at:

```text
ASR contextual prompt
ASR hotword system where supported
Post-ASR correction
Translation preservation
Caption formatting
```

Do not enable VALORANT vocabulary in general conversations unless the VALORANT preset is active.

## 7.6 Language-aware providers

For known Mandarin sources:

```text
SenseVoice → force Mandarin instead of auto
Whisper → language zh
Chinese-focused model → Mandarin mode
```

For Mandarin-English sources:

```text
Use a code-switch capable model
or
Use primary-preferred detection with zh + en
```

Avoid full unrestricted language detection when the user already knows the possible languages.

---

# 8. Phase 4 — Adaptive VAD and Segmentation

Create VAD profiles instead of using one universal configuration.

## Fast callouts

```text
Pre-roll: 300–400 ms
End silence: 350–550 ms
Maximum utterance: 10–15 seconds
```

## Natural conversation

```text
Pre-roll: 350–450 ms
End silence: 650–900 ms
Maximum utterance: 20–30 seconds
```

## Meetings

```text
Pre-roll: 400–500 ms
End silence: 900–1300 ms
Maximum utterance: 30–45 seconds
```

## Automatic tuning

Collect:

```text
Clipped beginning count
Clipped ending count
Average utterance duration
Forced-split frequency
Empty high-speech segments
VAD activation rate
```

Recommend changes:

```text
“Speech beginnings may be clipped. Increase pre-roll.”
“Sentences are being split too often. Increase end silence.”
“Captions arrive too slowly. Use the Fast Conversation profile.”
```

The existing VAD already exposes configurable speech thresholds, pre-roll, silence timing, and utterance duration, making this an extension of the current system rather than a rewrite.

---

# 9. Phase 5 — Clean UI Redesign

## 9.1 Main navigation

Recommended top-level navigation:

```text
Home
Sources
Live
History
Vocabulary
Models
Settings
```

## 9.2 Home screen

The home screen should answer three questions:

```text
What am I capturing?
Which languages are being used?
Am I ready to start?
```

Example:

```text
VALORANT Team Voice
CABLE Output → Headphones
Mandarin + English → English
Audio status: Ready
Model status: Ready

[Start Captions]
```

## 9.3 Hide implementation details

Normal settings:

```text
Quality
Languages
Use case
Caption appearance
Audio source
Monitoring output
```

Advanced settings:

```text
ASR provider
Translation provider
Beam size
VAD threshold
Silence duration
Model compute device
Inference queue
Prompt and hotwords
```

## 9.4 Clear runtime status

Show:

```text
Listening
Speech detected
Transcribing
Translating
Finalizing
```

Error states:

```text
No audio
Wrong device
Model unavailable
Performance overloaded
Monitoring loop
Language mismatch
```

Avoid generic messages such as:

```text
Live translation failed
```

Every error should include a likely cause and one direct action.

---

# 10. Phase 6 — General-Purpose Features

## Conversation mode

* Natural sentence segmentation
* Mandarin-English code-switching
* Larger caption history
* Optional source text and translation
* Replay button

## Meeting mode

* Longer utterance windows
* Transcript history
* Speaker/source labels
* TXT, SRT, VTT, JSON, and Markdown export
* Optional post-session summary

## Streaming mode

* OBS browser-source output
* Local WebSocket caption stream
* Caption delay control
* Profanity and phrase filtering
* Custom caption themes

## Language-learning mode

* Original transcript
* Translation
* Pinyin or romanization where supported
* Slow audio replay
* Vocabulary saving
* Repeat current phrase

## Accessibility mode

* Large persistent captions
* High-contrast display
* Caption replay
* Optional translated TTS
* Keyboard controls
* Longer caption retention

---

# 11. Diagnostics

Create two diagnostic levels.

## Simple diagnostics

```text
Audio source: Working
Voice detected: Yes
Signal quality: Good
Language: Mandarin
ASR: Ready
Translation: Ready
Performance: Good
```

## Advanced diagnostics

```text
Input sample rate
Channel count
Input RMS
Peak level
Clipping ratio
VAD probability
Utterance duration
Packets received
Packets dropped
Final jobs queued
Provisional jobs dropped
ASR latency
Translation latency
Detected language
Model runtime
GPU/CPU usage
```

Allow exporting a diagnostic bundle containing:

```text
Configuration
Device names
Model versions
Recent metrics
Sanitized logs
No raw audio unless explicitly approved
```

---

# 12. Quality Assurance Matrix

Every release should test:

## Operating systems

```text
Windows 10
Windows 11
Apple Silicon macOS
```

## Hardware

```text
CPU-only
Entry NVIDIA GPU
Mid-range NVIDIA GPU
High-end NVIDIA GPU
Apple M-series
```

## Audio sources

```text
VB-CABLE
Physical microphone
Discord
VALORANT voice chat
Browser meeting
System loopback
Recorded files
```

## Languages

```text
Mandarin
Cantonese where supported
English
Mandarin-English
Tagalog
Tagalog-English
Indonesian
Additional supported languages
```

## Audio conditions

```text
Clean virtual voice
Quiet remote microphone
Clipped microphone
Compressed voice chat
Fast speech
Slow speech
Short callouts
Long sentences
Overlapping speakers
```

## Failure cases

```text
VB-CABLE missing
Wrong cable endpoint
Monitoring loop
Silent source
Model missing
CUDA unavailable
Inference overloaded
Device disconnected mid-session
Application changes output device
```

---

# 13. Success Metrics

## Setup success

* At least 90% of users complete VB-CABLE setup without external documentation.
* Median setup requires no more than one device refresh.
* Users can clearly identify `CABLE Input` versus `CABLE Output`.
* Audio isolation test passes before the first session.

## Recognition

* Zero wrong-language fallback caused by profile mapping.
* Zero intentionally dropped raw-audio packets during normal operation.
* Mandarin benchmark improves meaningfully over the current baseline.
* Beginning and ending clipping remain below an agreed threshold.
* Hallucination rate is measured and tracked per provider.

## Performance

Balanced mode target:

```text
Provisional caption: under 1.5 seconds
Final caption: under 2.5 seconds after speech ends
```

Exact targets should be hardware-specific.

## Reliability

* A model failure does not terminate the session.
* Audio-device disconnection produces a recoverable state.
* Monitoring loops are detected.
* Stale provisional captions never overwrite final captions.
* Source profiles survive application restarts.

---

# 14. Release Roadmap

## v0.8 — Stable General Foundation

Deliver:

* Correct language-profile routing
* No raw-audio packet dropping
* Corrected non-speech filtering
* Source-origin system
* Domain preset foundation
* General Conversation preset
* VALORANT preset
* Discord preset
* VB-CABLE setup wizard
* Isolation and monitoring tests
* Improved diagnostics
* Saved routing profiles

Release requirement:

> A new Windows user can install yTSRL, configure VB-CABLE, route VALORANT or Discord voice, and start captions without reading external documentation.

## v0.9 — Recognition Quality

Deliver:

* Two-stage ASR
* Fast, Balanced, and Best Quality profiles
* Language-aware model routing
* Mandarin and Mandarin-English improvements
* Contextual prompts
* Vocabulary and hotwords
* Confidence fallback
* Adaptive VAD profiles
* Expanded Accuracy Lab
* Real benchmark reports

Release requirement:

> Final captions consistently outperform provisional captions, and model choices are validated using real routed-audio datasets.

## v1.0 — General Public Product

Deliver:

* Gaming, Conversation, Meeting, Streaming, Language Learning, and Accessibility modes
* Simplified onboarding
* Clean non-technical UI
* Transcript and subtitle exports
* OBS output
* Stable Windows and macOS packages
* Clean-machine installation validation
* Recovery flows for missing devices, models, and GPU dependencies
* Documentation and privacy explanation

Release requirement:

> The application works as a general real-time subtitle product while retaining an excellent one-click VALORANT experience.

---

# 15. Recommended Implementation Order

1. Fix the language-routing defect.
2. Remove raw-audio packet dropping.
3. Correct Whisper segment filtering.
4. Add recording and benchmark tools.
5. Introduce the source-origin data model.
6. Build the VB-CABLE detection and setup wizard.
7. Add voice and isolation tests.
8. Add General Conversation and VALORANT presets.
9. Introduce simplified quality profiles.
10. Implement two-stage recognition.
11. Add contextual vocabulary and fallback decoding.
12. Add adaptive VAD profiles.
13. Redesign Home, Sources, and Live screens.
14. Add meeting, streaming, learning, and accessibility outputs.
15. Complete v1.0 clean-machine QA.

---

# 16. Features to Avoid Initially

Do not prioritize these before the core workflow is reliable:

* Heavy universal noise suppression
* Universal speaker diarization
* Large LLM summaries during live sessions
* Automatic voice cloning
* Loading several large ASR models simultaneously
* Full system-audio source separation
* Automatic routing changes without user confirmation

The primary product promise should remain:

```text
Cleanly routed audio
Reliable speech segmentation
Accurate language-aware recognition
Fast and readable captions
Simple setup
```

---

# 17. Final Architecture

```text
Desktop Application
│
├── Onboarding and Setup
│   ├── use-case selection
│   ├── VB-CABLE detection
│   ├── routing wizard
│   ├── monitoring test
│   └── isolation test
│
├── Source Manager
│   ├── virtual voice channel
│   ├── physical microphone
│   ├── application audio
│   ├── system mix
│   └── recorded files
│
├── Preset System
│   ├── general conversation
│   ├── VALORANT
│   ├── gaming
│   ├── Discord
│   ├── meeting
│   ├── streaming
│   └── accessibility
│
├── Audio Engine
│   ├── endpoint capture
│   ├── monitoring
│   ├── format validation
│   ├── optional light processing
│   ├── VAD
│   └── utterance segmentation
│
├── Inference Router
│   ├── language configuration
│   ├── provisional ASR
│   ├── final ASR
│   ├── confidence fallback
│   └── translation
│
├── Text Processing
│   ├── normalization
│   ├── contextual vocabulary
│   ├── glossary correction
│   ├── phrase filtering
│   ├── translation preservation
│   └── confidence classification
│
└── Outputs
    ├── live overlay
    ├── caption history
    ├── transcript export
    ├── subtitle export
    ├── OBS/WebSocket
    └── optional TTS
```

The most important architectural decision is:

> VALORANT becomes an optimized preset, while clean virtual-audio routing, language-aware recognition, and reliable captions become the core product.
