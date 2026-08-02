# macOS (Apple Silicon M4) Reliability Assessment & Recommended Stack

Status: assessment only — no macOS port is committed yet.

## 1. Where the project stands on macOS today

The project targets Windows 11 first. Running on an Apple Silicon Mac today:

| Area | Status | Notes |
|---|---|---|
| Desktop app + overlay (Tauri 2) | **Runs** (dev mode) | Both windows render; transparent, always-on-top, click-through work on macOS |
| Global hotkeys | **Works** | `tauri-plugin-global-shortcut` uses Carbon; some keys need Accessibility permission |
| Model management (catalog, download, install, delete) | **Works** | Pure Rust; the mirror support added in 0.2.0 applies on every platform |
| Python inference sidecar (VAD, Whisper, NLLB) | **Runs** (CPU) | `faster-whisper`/`ctranslate2`/`onnxruntime`/`sherpa-onnx` all ship macOS arm64 wheels |
| Real audio capture (loopback / mic) | **Not available** | The live pipeline is wired to WASAPI; macOS exposes only synthetic demo endpoints |
| Device-change watcher | **Not available** | `WindowsDeviceWatcher` is Windows-only |
| Live translation end-to-end | **Demo only** | Works with the synthetic audio source, not real voice chat |

Two concrete compile-time gaps were found and fixed in 0.2.0:

- `synthetic_monitor_endpoint` was used in the non-Windows path of
  `audio_endpoints`/`platform_endpoints` but never imported on macOS — the
  macOS build did not compile. Fixed in `apps/desktop/src-tauri/src/lib.rs`.
- `cargo test --workspace` and `cargo clippy --workspace --all-targets` now
  pass on macOS.

The honest framing: **on an M4 Mac the app currently runs as a development /
demo environment, not as a usable companion.** The blockers are audio capture
and, secondarily, inference performance tuning.

## 2. The hard problem: capturing voice-chat audio on macOS

Windows solves this with WASAPI loopback on any render endpoint (ADRs
001/008/009). macOS has no equivalent public API for arbitrary app audio:

| Option | How it works | Cost | Verdict |
|---|---|---|---|
| **BlackHole 2ch** (Rogue Amoeba, open source, free) | A signed virtual audio device. User routes VALORANT audio to BlackHole (VALORANT lets you pick an output device); the app captures its input via CoreAudio/CPAL | Install a `.dmg` driver once; `cpal` already supports CoreAudio capture | **Recommended** — matches the project's "ordinary audio endpoints only" boundary (no hooks, no injection) |
| ScreenCaptureKit (macOS 13.3+) | Captures system audio of the *default* output device | Requires Screen Recording permission; limited to one output | Fallback for zero-install setups; captures the whole system mix, not per-app |
| Soundflower / other virtual drivers | Same idea as BlackHole | Third-party trust burden | Not recommended |

Port plan: a `CoreAudioDeviceWatcher` + `CoreAudioEndpointCatalog` in
`audio-core` behind the same trait boundary as the Windows catalog, a
"loopback" capture of the BlackHole render endpoint, and the existing
`AudioRouter` playback into it for monitoring. No new IPC, sidecar, or overlay
work is needed — the capture abstraction is already trait-based.

## 3. Recommended inference stack for M4 (2026)

The Python sidecar architecture carries over; only the ASR/MT runtimes should
be swapped or tuned.

### Speech recognition — use `mlx-whisper` (or whisper.cpp), not faster-whisper

`faster-whisper` (CTranslate2) has **no Metal backend** — on Apple Silicon it
runs CPU-only (~3× real-time for large-v3). M-series hardware is wasted.

| Runtime | M4 behavior | Notes |
|---|---|---|
| **mlx-whisper** | GPU/ANE accelerated; `large-v3-turbo` roughly real-time+ | Python in-process (fits the sidecar), pip-installable, int4/8 quantized MLX weights; greedy decoding only (no beam search — acceptable for captions) |
| **whisper.cpp (Metal/CoreML)** | ~7–10× real-time large-v3 on M-series; ANE encoder path | Fastest, but C/C++ — would need a small native bridge or `pywhispercpp` wrapper |
| faster-whisper (current) | CPU-only ~3× real-time | Fine for dev; too slow for low-latency captions on the same pipeline that works on Windows |

Recommendation: make the ASR provider pluggable per platform (it already is —
`whisper-turbo`/`whisper-full` providers) and add an `mlx-whisper` provider on
macOS. Whisper weights stay MIT-licensed; checksums/manifests still apply.

### Translation — keep NLLB via CTranslate2, measure, consider MLX later

- CTranslate2 ships macOS arm64 wheels; NLLB-600M int8 runs on CPU. The M4's
  performance cores make this usable (roughly 1–3 s per caption sentence), but
  there is no Metal acceleration.
- MLX ports of NLLB exist in the community but are less maintained; a swap is
  not justified until real M4 latency measurements exist.
- MADLAD-400 stays irrelevant on macOS (CPU-only candle, ~50 s per caption).

### Latency budget on M4 (expected, unverified)

ASR (mlx-whisper turbo, 5 s utterance) ≈ 0.5–1.5 s; NLLB CPU ≈ 1–3 s; total
draft ≈ 2–4 s — acceptable for a captioning companion but slower than the
Windows CUDA path (tens of ms for NLLB). Measure before optimizing; the
diagnostics panels already expose per-stage latency.

## 4. What else a macOS port needs

1. **CoreAudio device watcher + endpoint catalog** (see §2) — the only
   Windows-specific abstraction used by the live path.
2. **Permissions UX**: Microphone permission for mic capture; Accessibility
   for hotkeys; Screen Recording only if ScreenCaptureKit fallback is used.
3. **Packaging**: Tauri DMG build already configured (`bundle.targets: all`,
   ad-hoc `signingIdentity: "-"`). For distribution beyond direct download,
   notarization is required.
4. **CI**: add `macos-latest` jobs to `.github/workflows/ci.yml` so the macOS
   build is exercised continuously (it was broken and uncaught until 0.2.0).
5. **Sidecar packaging**: PyInstaller already cross-platform; the frozen
   `local-squad-sidecar` would ship as a macOS binary in the app bundle.

## 5. What is NOT needed on macOS

- No new overlay work (Tauri transparent windows already work).
- No new hotkey work (plugin is cross-platform).
- No changes to the caption pipeline, IPC protocol, or model manager.
- No kernel drivers: BlackHole is an installable audio HAL driver, matching
  the "ordinary audio endpoints" boundary; ScreenCaptureKit needs no driver.

## 6. Recommended next steps (in order)

1. Add `macos-latest` CI for the Rust/TS/Python checks (prevents regressions).
2. Port the endpoint catalog + watcher to CoreAudio in `audio-core`
   (same traits as `WindowsEndpointCatalog`).
3. Add the `mlx-whisper` ASR provider to the sidecar (keep faster-whisper on
   Windows).
4. Benchmark NLLB on an M4; decide CTranslate2-CPU vs MLX.
5. Package and notarize a DMG.
