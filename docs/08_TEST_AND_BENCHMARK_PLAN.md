# Test and Benchmark Plan

## 1. Test Pyramid

### Unit

- ring buffers;
- resampler bookkeeping;
- downmix;
- VAD state machine;
- stable-prefix algorithm;
- glossary mask/restore;
- language heuristics;
- caption reducer;
- settings migrations;
- protocol validation;
- checksum verification.

### Integration

- virtual/synthetic audio source → sidecar;
- sidecar → overlay;
- device invalidation;
- sidecar crash;
- model load failure;
- OOM fallback;
- monitor playback;
- multi-monitor restoration.

### End-to-End

- prerecorded voice call through virtual endpoint;
- live Discord/voice test before VALORANT;
- VALORANT Borderless Windowed;
- clean-machine installer.

## 2. Audio Fixtures

Store only consented or appropriately licensed fixtures.

Directory:

```text
fixtures/audio/
├── silence/
├── noise/
├── tagalog/
├── cebuano/
├── taglish/
├── bislish/
├── english/
├── tactical/
└── overlap/
```

Each fixture has metadata:

```yaml
id: ceb_tactical_001
language: cebuano
speaker_region: optional-consented-label
transcript: "..."
english_reference: "..."
sample_rate: 48000
channels: 2
conditions:
  microphone: headset
  background: game_sfx
consent_record: internal-reference
```

Do not expose personal speaker information in the repository.

## 3. ASR Metrics

- WER for normalized word sequences.
- CER for languages/orthography where useful.
- tactical term exact accuracy.
- number accuracy.
- negation accuracy.
- destination/site accuracy.
- dropped utterance rate.
- hallucination on silence/noise.
- real-time factor.

Critical-error labels:

```text
NEGATION_FLIPPED
SITE_OR_DIRECTION_WRONG
NUMBER_WRONG
PLAYER_ACTION_WRONG
TERM_HALLUCINATED
SPEECH_OMITTED
```

## 4. Translation Metrics

Automatic metrics are secondary. Primary evaluation is bilingual human review.

Rubric, 1–5:

- meaning preservation;
- tactical usefulness;
- fluency;
- terminology;
- uncertainty appropriateness.

Critical translation errors include:

- “don't push” → “push”;
- A → B;
- left → right;
- one enemy → multiple enemies;
- save → buy;
- rotate → stay.

## 5. Latency Measurement

Timestamp stages:

```text
audio_captured
vad_speech_started
utterance_decode_queued
asr_started
asr_completed
translation_started
translation_completed
ipc_received
overlay_rendered
```

Report:

- p50;
- p90;
- p95;
- p99;
- maximum;
- count;
- dropped/coalesced count.

Separate:

- first provisional latency;
- final-after-speech latency;
- total final latency from utterance start.

## 6. Resource Measurement

Record:

- process CPU;
- working set;
- GPU utilization;
- VRAM;
- model load time;
- inference GPU time;
- audio underruns;
- game average FPS;
- game 1% low FPS;
- frame-time p95/p99 where available without game memory access.

Use external/system tools or user-observable benchmarks, not game internals.

## 7. Hardware Matrix

Primary:

- RTX 4070 Ti 12 GB;
- representative user CPU;
- 16/32 GB RAM;
- Windows 11 current stable.

Secondary:

- CPU-only;
- 8 GB GPU;
- integrated audio;
- USB headset;
- Bluetooth headset.

## 8. Model Comparison Matrix

| Profile | ASR | MT precision | Measure |
|---|---|---|---|
| Low | 300M int8 | aggressive quantized | latency/resource |
| Balanced | 300M int8 | validated Q4/Q8 | default |
| Quality A | 1B int8 | validated Q4/Q8 | accuracy gate |
| Quality B | 1B int8 | higher precision | non-game benchmark |

A candidate wins only if it improves critical meaning enough to justify its cost.

## 9. Soak Tests

### Two-Hour Audio Soak

- continuous endpoint;
- intermittent speech;
- no game;
- measure memory and queue stability.

### Match-Length Soak

- game running;
- several speech bursts;
- overlay enabled;
- diagnostics reduced;
- no history.

### Device Churn

- unplug headset;
- reconnect;
- disable/enable cable;
- sleep/wake;
- change default device.

## 10. Overlay Tests

- 1080p;
- 1440p;
- 4K scaling;
- 100/125/150/200% DPI;
- single monitor;
- mixed-DPI dual monitor;
- taskbar positions;
- game window focus;
- Alt+Tab;
- Windows key;
- edit mode;
- invisible/off-screen recovery.

## 11. Security Tests

- connect without token;
- malformed JSON;
- oversized frame;
- invalid binary header;
- rapid reconnect;
- path traversal in model ID;
- checksum mismatch;
- symlink/reparse-point handling;
- sidecar argument injection;
- log redaction;
- LAN connection attempt.

## 12. Acceptance Threshold Process

Do not invent final quality thresholds before collecting baseline data.

Process:

1. Build evaluation set.
2. Run baseline.
3. Categorize critical failures.
4. Define minimum release threshold with native speakers.
5. Freeze benchmark version.
6. Use regression budget for future changes.

## 13. Benchmark Command Contract

Target commands:

```powershell
python -m services.inference.bench.asr --manifest fixtures/manifest.yaml
python -m services.inference.bench.mt --manifest fixtures/manifest.yaml
python -m services.inference.bench.e2e --manifest fixtures/manifest.yaml
cargo run -p diagnostics -- audio-soak --minutes 120
pnpm --filter desktop test:e2e
```

Each command writes:

- machine-readable JSON;
- human-readable Markdown;
- exact git commit;
- model checksums;
- hardware summary;
- configuration.
