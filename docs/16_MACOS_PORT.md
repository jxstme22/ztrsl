# macOS (Apple Silicon M4) Reliability Assessment & Recommended Stack

Status: **partially implemented** (v0.6). CoreAudio capture (mic + BlackHole
loopback), ScreenCaptureKit system-audio capture, the device watcher, and the
MLX Whisper ASR provider are in; the control window runs vibrancy glass and a
windowed overlay mode on macOS. DMG packaging works (ad-hoc signed); permissions
UX and further polish remain. Windows stays first-class; the macOS backend
mirrors the same trait surface.

## 1. Where the project stands on macOS today

The project targets Windows 11 first. Running on an Apple Silicon Mac today:

| Area | Status | Notes |
|---|---|---|
| Desktop app + overlay (Tauri 2) | **Runs** (dev mode) | Both windows render; transparent, always-on-top, click-through work on macOS |
| Global hotkeys | **Works** | `tauri-plugin-global-shortcut` uses Carbon; some keys need Accessibility permission |
| Model management (catalog, download, install, delete) | **Works** | Pure Rust; the mirror support added in 0.2.0 applies on every platform |
| Python inference sidecar (VAD, Whisper, NLLB) | **Runs** | `faster-whisper`/`ctranslate2`/`onnxruntime`/`sherpa-onnx` all ship macOS arm64 wheels |
| Real audio capture (mic / BlackHole loopback) | **Implemented (v0.5)** | `MacosEndpointCatalog`/`MacosDeviceWatcher`/`MacosAudioCapture` in `audio-core`; the live loop uses real capture |
| System-audio capture (no install) | **Implemented (v0.6)** | `MacosSystemAudioCapture` in `audio-core` taps the whole output mix via ScreenCaptureKit (macOS 13+); surfaced as the "System Audio (all apps)" source — no BlackHole, no routing |
| Device-change watcher | **Implemented (v0.5)** | Poll-based CoreAudio diff in `audio-core/src/macos.rs` |
| Apple Silicon ASR (MLX) | **Implemented (v0.5)** | `mlx-whisper-large-v3-turbo-q4` catalog entry; `mlx` ASR provider runs on Metal |
| Live translation end-to-end | **Works with real capture** | Mic, BlackHole input, or system audio feeds VAD → MLX Whisper → NLLB |
| Native window glass (vibrancy) | **Implemented (v0.6)** | `window-vibrancy` behind `apply_window_shell`; transparent webview no longer renders flat black |
| Windowed overlay mode | **Implemented (v0.6)** | Titlebar button morphs the control window into an always-on-top caption strip; separate overlay window disabled on macOS (renders black without vibrancy) |
| Sandboxed app bundle | **Implemented (v0.6)** | App Sandbox + network client + audio input + user-selected file read entitlements; `NSScreenCaptureUsageDescription` for system audio |
| Sandboxed writes | **Implemented (v0.6)** | All user-visible writes (model store, sidecar logs/caches) are redirected into the sandbox container `~/Library/Containers/app.localsquadtranslator.desktop/Data`; the sidecar gets a container `HOME` + `HF_HOME`/`XDG_CACHE_HOME`/`TORCH_HOME`/`MPLCONFIGDIR`/`PYTHONPYCACHEPREFIX`. Without this the sandbox denies real-home writes with EPERM ("Operation not permitted") |
| Sandboxed loopback IPC | **Implemented (v0.6)** | `com.apple.security.network.server` entitlement added: the supervisor binds an ephemeral 127.0.0.1 port to hand the sidecar its IPC endpoint; without it the bind fails EPERM and live translation dies at startup. The author's personal build runs **unsandboxed** (empty entitlements plist) |
| System-audio diagnostics | **Implemented (v0.6)** | Silent TCC denial (no Screen Recording permission) makes SCK start without ever delivering audio. The live loop now fails after 4s of zero buffers with guidance, and Settings → Diagnostics has an "Open System Settings" button for the Screen Recording pane |
| Device enumeration | **Fixed (v0.6)** | macOS 26 rejects the legacy CoreAudio size-query pattern (`AudioObjectGetPropertyData` with NULL outData → 'nope') for `kAudioHardwarePropertyDevices`, emptying the catalog. All property reads now go through `AudioObjectGetPropertyDataSize`; mic/BlackHole/speakers enumerate again |

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
| **ScreenCaptureKit (macOS 13+)** | Taps the system audio mix of the current output setup; implemented as `MacosSystemAudioCapture` and the "System Audio (all apps)" source | Screen Recording permission prompt on first use; captures the whole system mix, not per-app | **Default (v0.6)** — zero-install, no routing; matches the project's "ordinary endpoints / OS permission" boundary |
| **BlackHole 2ch** (Rogue Amoeba, open source, free) | A signed virtual audio device. User routes VALORANT audio to BlackHole (VALORANT lets you pick an output device); the app captures its input via CoreAudio/CPAL | Install a `.dmg` driver once; `cpal` already supports CoreAudio capture | Recommended when per-app separation matters — still supported (v0.5 path unchanged) |
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

### Latency budget on M4 (measured, v0.5)

Measured on an M-series Mac (arm64, macOS):

- **NLLB-600M int8 (CTranslate2, CPU)**: ~**340 ms average** per caption
  sentence (p50 340 ms, max 484 ms on a 4-sentence sample). Far below the
  earlier 1–3 s estimate — CTranslate2-CPU NLLB stays the macOS default; no
  MLX NLLB swap is justified.
- **MLX Whisper large-v3-turbo-q4 (Metal)**: a 3 s audio clip decodes in
  ~2.6 s including model warm-up on first call (progressive decode; steady
  state is faster). Model load ~1.5 s.
- **Total draft** (5 s utterance, warm): ASR + NLLB ≈ 1–3 s — acceptable for
  a captioning companion, and much faster than the Windows CUDA path's tens
  of ms per stage. Measure per-stage with the diagnostics panels.

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

1. ~~Add `macos-latest` CI for the Rust/TS/Python checks~~ **Done** (v0.3).
2. ~~Port the endpoint catalog + watcher to CoreAudio in `audio-core`~~ **Done**
   (v0.5): `MacosEndpointCatalog`, `MacosDeviceWatcher`, `MacosAudioCapture`,
   `MacosAudioPlayback`; the live loop now captures real audio on macOS.
3. ~~Add the `mlx-whisper` ASR provider~~ **Done** (v0.5): `mlx` provider +
   `mlx-whisper-large-v3-turbo-q4` catalog entry (~440 MB, Metal).
4. ~~Benchmark NLLB on an M4~~ **Done** (v0.5): ~340 ms/sentence CPU — keep
   CTranslate2; no MLX swap.
5. **Remaining**: macOS permissions UX (mic prompt + guidance, first-run Screen
   Recording hint for system audio), DMG notarization for distribution beyond
   direct download, and UI polish (windowed overlay placement memory).
