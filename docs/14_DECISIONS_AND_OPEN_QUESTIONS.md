# Decisions and Open Questions

## Accepted Decisions

### D-001 Windows First

Target Windows 11 x64 only for V1 because VALORANT and the required overlay/audio workflow are Windows-centric.

### D-002 External Overlay Only

No injection, hooks, game memory, packet inspection, or game automation.

### D-003 Virtual Cable for V1

Use a signed third-party virtual cable installed by the user to isolate voice output.

### D-004 Local Processing

No cloud fallback in V1.

### D-005 Cascaded ASR → MT

Keep source transcript available and translation independently replaceable.

### D-006 Provisional + Final Captions

Fast previews are visually distinguished from stable final captions.

### D-007 Tagalog Quality Default

ADR-012 supersedes the planned 300M default. Tagalog V1 uses forced-Filipino Faster-Whisper
large-v3 CUDA FP16; Cebuano remains benchmark-gated.

### D-008 Game Gets Resource Priority

Inference quality may be reduced to protect frame time.

### D-009 No History by Default

Audio and transcript content are ephemeral.

### D-010 Python Sidecar First

Optimize to native runtime only after a working, measured baseline.

## Open Questions to Resolve Through Tests

### OQ-001 Exact 4070 Ti Variant

Is the target GPU 12 GB or another variant? Record actual VRAM and driver.

### OQ-002 Best Translation Runtime

Compare:

- PyTorch Transformers;
- ONNX Runtime;
- CTranslate2 if compatible;
- validated GGUF runtime.

Decision criteria: quality parity, VRAM, latency, packaging.

### OQ-003 MADLAD Cebuano/Filipino Quality

Model family coverage does not guarantee gaming-conversation quality. Must benchmark native speakers.

### OQ-004 Explicit ASR Language Conditioning

Confirm exact Omnilingual API/checkpoint language conditioning and IDs.

### OQ-005 Voice Output Routing in Current VALORANT Client

Confirm current menu names and whether voice output can be independently routed on the user's installation.

### OQ-006 Monitoring Latency

Measure whether app-forwarded audio is comfortable. Consider Windows “Listen to this device” only as a fallback, not primary architecture.

### OQ-007 Overlay Flags

Determine whether Tauri APIs suffice or a small `windows-rs` window-style module is required.

### OQ-008 Quantized Translation Artifact

Choose a trusted reproducible quantization path. Do not adopt random community conversions without provenance.

### OQ-009 Game Performance Threshold

Agree on maximum acceptable change to average FPS, 1% lows, and p99 frame time.

### OQ-010 Native Speaker Release Threshold

Set after baseline measurement with bilingual reviewers.

### OQ-011 Product Name

Must not imply Riot endorsement or look official.

### OQ-012 Public Distribution

Requires current policy review, registration, license review, signing, and privacy materials.
