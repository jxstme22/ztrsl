# Data Models and Local Protocol

## 1. Protocol Goals

- local only;
- versioned;
- authenticated per launch;
- bounded messages;
- deterministic;
- testable without models;
- forwards-compatible where possible.

## 2. Transport

V1: WebSocket bound to `127.0.0.1` on an ephemeral port.

Desktop launches sidecar with environment/arguments:

```text
LST_IPC_PORT
LST_IPC_TOKEN
LST_PROTOCOL_VERSION
LST_MODEL_DIR
LST_PROFILE
```

The token is generated per launch, never persisted, and included in the first authenticated handshake.

A named pipe may replace WebSocket later if it materially simplifies packaging/security.

## 3. Envelope

```json
{
  "protocol_version": 1,
  "message_id": "uuid",
  "session_id": "uuid",
  "type": "caption.final",
  "sent_monotonic_ns": 123456789,
  "payload": {}
}
```

## 4. Handshake

Desktop → sidecar:

```json
{
  "type": "hello",
  "payload": {
    "token": "random-per-launch",
    "desktop_version": "0.1.0",
    "protocol_versions": [1],
    "capabilities": ["pcm_f32le", "caption_revisions"]
  }
}
```

Sidecar → desktop:

```json
{
  "type": "hello.accepted",
  "payload": {
    "protocol_version": 1,
    "sidecar_version": "0.1.0",
    "models": {
      "vad": "silero-vad",
      "asr": "omni-ctc-300m-int8",
      "translation": "madlad-400-3b"
    }
  }
}
```

Reject:

- invalid token;
- incompatible version;
- oversized first frame;
- non-loopback peer;
- repeated authentication.

## 5. Audio Frames

Use binary frames for PCM data with a compact fixed header or MessagePack. Keep JSON control frames separate.

Required metadata:

```text
protocol version
session UUID
sequence number
capture monotonic ns
sample rate
channel count
sample format enum
sample count
flags
```

Maximum binary frame size must be enforced.

## 6. Control Messages

Desktop → sidecar:

```text
session.start
session.stop
config.update
audio.flush
models.load
models.unload
diagnostics.request
shutdown
```

Sidecar → desktop:

```text
health
vad.state
utterance.started
asr.provisional
asr.final
caption.provisional
caption.final
caption.error
metrics
models.status
fatal
```

## 7. Caption Schema

```json
{
  "caption_id": "uuid",
  "utterance_id": "uuid",
  "revision": 3,
  "status": "provisional",
  "source_mode": "cebuano",
  "source_text": "adto ta b",
  "english_text": "let's go B",
  "started_monotonic_ns": 1000,
  "ended_monotonic_ns": null,
  "capture_to_caption_ms": 1080.4,
  "asr_ms": 310.2,
  "translation_ms": 240.8,
  "confidence": null,
  "warnings": []
}
```

Rules:

- revisions strictly increase per caption ID;
- final status is terminal except explicit error tombstone;
- desktop discards stale revisions;
- strings have maximum lengths;
- warnings are enums, not arbitrary logs.

## 8. Settings Schema

Version settings with migrations.

```json
{
  "schema_version": 1,
  "audio": {
    "capture_endpoint_id": null,
    "playback_endpoint_id": null,
    "monitor_enabled": true,
    "monitor_volume": 1.0
  },
  "language": {
    "source_mode": "mixed",
    "show_source": true
  },
  "models": {
    "profile": "balanced",
    "asr_model": "omni-ctc-300m-int8",
    "translation_model": "madlad-400-3b-q4"
  },
  "overlay": {
    "enabled": true,
    "monitor_id": null,
    "x_normalized": 0.5,
    "y_normalized": 0.78,
    "width_normalized": 0.55,
    "font_scale": 1.0,
    "background_opacity": 0.65
  },
  "privacy": {
    "save_transcripts": false,
    "save_audio": false,
    "telemetry": false
  }
}
```

Secrets/tokens do not belong in settings.

## 9. Model Manifest

```yaml
schema_version: 1
id: omni-ctc-300m-int8
kind: asr
runtime: sherpa-onnx
source:
  organization: k2-fsa
  upstream: facebookresearch/omnilingual-asr
license:
  spdx: Apache-2.0
artifacts:
  - path: model.int8.onnx
    sha256: PLACEHOLDER_TO_BE_FILLED_FROM_RELEASE
  - path: tokens.txt
    sha256: PLACEHOLDER_TO_BE_FILLED_FROM_RELEASE
compatibility:
  windows_x64: true
  minimum_app_version: 0.1.0
```

Do not ship placeholder checksums. The model download implementation is incomplete until real pinned checksums are committed.

## 10. Error Taxonomy

```text
AUDIO_DEVICE_NOT_FOUND
AUDIO_DEVICE_INVALIDATED
AUDIO_FEEDBACK_SUSPECTED
AUDIO_CAPTURE_STALLED
IPC_AUTH_FAILED
IPC_VERSION_MISMATCH
MODEL_MISSING
MODEL_CHECKSUM_FAILED
MODEL_LOAD_FAILED
CUDA_UNAVAILABLE
CUDA_OUT_OF_MEMORY
ASR_FAILED
TRANSLATION_FAILED
OVERLAY_UNAVAILABLE
HOTKEY_CONFLICT
CONFIG_INVALID
```

Each error maps to:

- user title;
- user action;
- retryability;
- technical details for logs;
- privacy classification.

## 11. Logging

Structured event example:

```json
{
  "level": "info",
  "event": "caption.final",
  "utterance_id": "redacted-hash",
  "latency_ms": 1320,
  "source_mode": "cebuano",
  "text_length": 28
}
```

Do not log transcript content by default.
