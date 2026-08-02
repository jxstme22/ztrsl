# ADR-012: Native Packaging via PyInstaller + Tauri externalBin

## Status
Accepted

## Context
The app depends on a Python sidecar (`local_squad_inference.sidecar`) for ASR,
translation, and VAD. The sidecar imports `faster-whisper`, `ctranslate2`,
`sherpa-onnx`, `onnxruntime`, `numpy`, `websockets`, `av`, and `bzip2`. In
development the sidecar runs from source via `python -m ...` inside a `.venv`.
A packaged `.exe` cannot assume Python is installed.

## Decision

### Sidecar
Bundle the Python sidecar as a PyInstaller onedir executable. The build script
(`scripts/build-sidecar.mjs`) creates `target/sidecar/` containing the frozen
app and its `_internal/` dependency tree. The onedir format avoids the
antivirus false positives and slow startup common with one-file mode.

PyInstaller must collect:
- The `local_squad_inference` package (sidecar entry point)
- Data files from `faster_whisper` (the bundled `silero_vad_v6.onnx` model)
- Hidden imports for `ctranslate2`, `onnxruntime`, `sherpa_onnx`, `av`,
  `websockets`, `bzip2`

### Rust binary
The `translation-runner` (MADLAD-400 candle runner) was already built by
`scripts/ensure-translation-runner.mjs` and is shipped via Tauri
`externalBin` — the `tas` API resolves its path at runtime.

### Tauri bundle config
`tauri.conf.json` gains:
- `bundle.resources`: sidecar onedir directory
- `bundle.externalBin`: path to `translation-runner.exe`
The NSIS installer places both next to the main `.exe`.

### Runtime detection
`SidecarConfig::for_workspace` continues to work in development (detects the
workspace `services/inference/src` directory). In a packaged build the
workspace layout does not exist, so the app falls back to resolving the
sidecar exe from the Tauri resource directory and stores models in
`%LOCALAPPDATA%/xTRSNLTR/models` (writable for standard users).

### What is NOT bundled
- Model artifacts — they are downloaded on demand by the Model Manager
  (ADR-011) from the pinned public sources listed in `models/catalog.json`.
- NGC API keys or HF tokens — the NGC export scripts and gated HF repos
  remain development-only tools.

## Consequences
- First packaged build size: ~150 MB (Rust binaries ~10 MB, sidecar onedir
  ~80 MB with CUDA DLLs, CUDA runtime loader ~50-60 MB).
- Users need no Python, no venv, no ML packages.
- The sidecar still supports GPU inference via CUDA (onnxruntime + ctranslate2
  CUDA providers) — the same CUDA DLLs bundled by PyInstaller work when
  detected at runtime.
- Model store size grows as users add models (typical install: whisper-turbo
  + nllb ≈ 2.2 GB).
- AV false positives from PyInstaller onedir are rare compared to one-file;
  code signing will eliminate the remaining risk.