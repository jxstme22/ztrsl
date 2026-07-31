# Model Artifacts

Model binaries are not committed and are not downloaded by normal application startup.

Every future artifact must have:

- a pinned official or vetted source;
- an exact license record;
- expected size and SHA-256 checksum;
- a safe local format such as ONNX or safetensors;
- atomic installation and corrupt-file rejection;
- no `trust_remote_code` or executable model-provided code.

Downloaded artifacts belong under `models/artifacts/`, which is ignored by Git. Placeholder
checksums are never considered installable manifests.

## Development install

Install the optional runtimes:

```bash
uv sync --extra dev --extra models
```

Review the Apache-2.0 licenses and run the explicit installers:

```bash
python scripts/install_models.py whisper --accept-license
cargo build --release -p translation-runner
python scripts/install_models.py madlad --accept-license
```

Whisper large-v3 is about 3.1 GB in CTranslate2 form and is loaded as int8 on CPU or FP16 on CUDA.
Its committed manifest pins the exact Systran revision and verifies every required file before an
atomic install. The selected MADLAD Q4 GGUF is about 1.65 GB and comes from the same pinned Hugging
Face repository as the standard weights. The app never executes these downloads during startup or
clip analysis. The previously installed large-v3-turbo artifact remains a development fallback,
not the V1 quality default.

The earlier Omnilingual CTC 300M installer remains available as `asr` for research comparison, but
it is not the quality provider for offline clips. A consented noisy VALORANT DVR benchmark produced
uncontrolled Arabic, Chinese, and Korean script drift, while forced-Filipino Whisper preserved
Latin-script Tagalog phrases. Cebuano remains experimental until a language-conditioned
Omnilingual LLM-ASR candidate is benchmarked on the Windows GPU.

Committed hashes live in `models/manifests/`. Installed copies contain their own generated manifest
and are rechecked before loading.
