# 23 — Release Notes

## v0.5.2 — UI polish + caption alignment + download speed

- **Models page redesigned** — full-width cards matching Live / Diagnostics /
  Settings: same radius, padding, and hover, one card per model (no more
  cramped two-column grid).
- **Welcome card cleaned up** — removed the accent bar, icon mark, and the
  3-step strip; it now reads like the Live page: a simple title, a language
  picker, and the recommended model choices.
- **Setup wizard** — Back left, Next right, with a subtle divider so the nav
  bar reads clearly.
- **Caption paragraph alignment** — choose **left / center / right** in
  Settings (global) and per source in Sources. Per-source wins over global.
- **Download speed + ETA** — the Models and GPU progress bars now show
  `MB/s` and `time left` while downloading.
- **Footer gap fixed** — the last card now keeps clear space above the window
  edge when you scroll to the bottom.
- **Local vs cloud clearer** — cloud ASR/translation providers are marked
  `· Cloud` in the Live provider list, and the Groq key field now explains how
  to get a free key (console.groq.com).
- **macOS-only models are hidden on Windows** — the MLX Whisper weights no
  longer appear in the Windows Models page (platform-gated in the catalog).

## v0.5.1 — macOS is now real (CoreAudio capture + Apple Silicon ASR)

The Mac app was previously a development demo: only synthetic audio, CPU-only
Whisper. Now the live pipeline works end-to-end on Apple Silicon:

- **Real CoreAudio capture** — `MacosEndpointCatalog` enumerates your real
  input/output devices; `MacosAudioCapture` captures your microphone or a
  virtual device like BlackHole's input (the macOS answer to VB-CABLE — the
  game routes voice-chat output to BlackHole, the app captions that mix).
  `MacosDeviceWatcher` flags device add/remove changes so the endpoint list
  stays fresh. The Live page's source list now groups BlackHole as a
  "loopback" capture on Mac, exactly like WASAPI loopback on Windows.
- **Apple Silicon ASR (mlx-whisper)** — a new `mlx` ASR provider runs
  Whisper large-v3-turbo on the Metal GPU/ANE via the MLX `-q4` weights
  (~440 MB, pinned + checksum-verified). Roughly real-time captions on
  M-series, where CTranslate2 was CPU-only (~3x real-time).
- **NLLB measured on M4**: ~340 ms/sentence on CPU — well under budget, so
  NLLB stays the macOS translator (no MLX swap needed). Recorded in
  `docs/16_MACOS_PORT.md`.
- **macOS setup guidance** — the Sources page shows a BlackHole + microphone
  permission hint when no virtual device is installed, and the app's Info.plist
  now declares microphone usage so the macOS permission prompt is clear.
- **Sidecar packaging** — `build-sidecar.mjs` bundles `mlx_whisper` on macOS
  only; Windows keeps faster-whisper/CUDA.

## v0.5.0 — GPU acceleration + full Chinese UI

**Live on a machine with an NVIDIA GPU but no CUDA Toolkit installed?** The
CUDA runtime is no longer a silent dead end. The app now ships an optional,
opt-in **GPU runtime pack**:

- The Models page gets a **"Enable GPU acceleration"** card. It downloads the
  pinned, checksum-verified NVIDIA `cu12` wheels (CUDA runtime + cuBLAS +
  cuDNN, ~1.3 GB) from PyPI and flattens their DLLs into the models dir —
  nothing ships in the ~74 MB installer.
- At sidecar startup the DLL dir is registered via `os.add_dll_directory`
  before ctranslate2 loads, so the GPU path (ASR + translation) works without
  a system CUDA install, admin rights, or PATH editing.
- The Live readout now shows the **active device** (`cuda/float16` vs
  `cpu/int8`), and a missing GPU runtime falls back to CPU cleanly instead of
  killing the session with a `cublas64_12.dll not found` error.

**Chinese (Simplified) is now applied across the whole interface** — Models,
Sources, Live, and Diagnostics read from the same global language store, so
changing the language in Settings re-renders every page (previously only
Settings itself changed).

## v0.4.2 — no more terminal window, polished UI

**The console window is gone for real.** The previous fix hid the sidecar's
console, but the app itself was still built as a Windows console-subsystem
program, so a terminal opened next to it and closing that terminal killed the
whole app. The app is now a proper GUI executable:
- no terminal opens on launch;
- the window's own close button works (closing it no longer kills the app);
- the sidecar + translation runner stay headless.

Also in v0.4.2:

- **Live start "audio capture stalled"** — the stall check no longer
  false-positives during a slow endpoint warm-up: it only begins counting once
  the first frame arrives, allows a longer grace period, and the error now
  suggests trying a different capture endpoint.
- **Welcome/onboarding** — shows on first run (even if models are already
  installed) and can be dismissed once.
- **Models page** — clearly shows **Installed** vs available with on-disk
  sizes and a live count header; the Live panel tags each ASR/MT option as
  `(not installed)` when the model isn't on disk.
- **Color picker** — replaced the unstylable OS popup with a branded swatch +
  preset palette matching the rest of the app.
- **Chinese (Simplified)** — now applied across Models, Sources, Diagnostics,
  and the Live panel (not just Settings/Welcome).
- **Footer spacing** — more bottom breathing room so the last card isn't flush
  against the window edge.

## v0.4.1 — headless background processes

Fixes the bad-launch UX: a terminal/console window used to appear alongside
the app and closing it killed the app. The Python inference sidecar and the
MADLAD translation runner now spawn **headless** on Windows
(`CREATE_NO_WINDOW`), so no console appears and closing it can no longer kill
the app.

Also in v0.4.1:

- **NCSpeech models now appear on the Models tab** — the three locally-exported
  CTC models (NCSpeech Tagalog, Citrinet Mandarin, Parakeet Mandarin) are
  surfaced as a "Local exports" section, detected from disk, with honest
  "Local export" status (they are generated locally, not downloaded).
- **CI mypy gate fixed** — all type errors in the v0.4 caption-trust modules
  and tests are resolved.

## v0.4.0 — Caption accuracy, overlap awareness, and trust

v0.4.0 focuses on the hard cases *inside* a valid source: overlapping
speakers, wrong tactical terms, uncertain output, phrase noise, glossary
corrections, and making Off/Balanced/Strict language handling real.

## New in v0.4.0

- **Accuracy Lab** — run one clip through several ASR/MT configurations and
  compare latency, caption counts, and critical tactical errors. Reports are
  content-free by default.
- **Language strictness** — Off/Balanced/Strict per source with forced
  language where supported, a language gate, and tactical short-callout
  bypass.
- **Phrase filters** — per-source exact/contains/similar/regex rules that drop
  noise (e.g. "user joined your channel") before translation.
- **Glossary editor** — preserve agent names, fix misheard ASR, force
  translations, and add aliases. Hot-reloads without a model restart.
- **Certainty states** — uncertain captions render distinctly
  (`[TEAM?]` + reasons); suppressed content is never flashed.
- **Overlap detection** — rapid back-to-back speakers per source are flagged,
  and heavy overlap is not confidently captioned by default.
- **Adaptive scheduler** — resource policies (maximum accuracy / balanced /
  protect game performance) throttle secondary provisionals under pressure.
- **Model recommendations** — explainable suggestions from your profile,
  hardware, and Accuracy Lab results (never auto-installed).

## Fixes from real-use testing (v0.3)

- Live start "model manifest is missing or invalid" — the sidecar now resolves
  both model-install layouts (CLI `artifacts/` and the in-app installer path).
- Clip Lab works with `.wav` files even without FFmpeg (pure-Python decoder).
- VB-CABLE detection corrected (CABLE Input is a render device, CABLE Output
  is a capture device).

## Interface languages

- **Chinese (Simplified)** — pick your interface language on the welcome card
  before first use, or change it anytime in Settings. The interface, welcome,
  models, and settings surfaces are translated.

## Not included

- No game-process access, memory reads, hooks, input automation, or
  anti-cheat evasion — by design.
- No cloud audio.

## Known limitations

- Windows 11 x64 is the target platform.
- VB-CABLE must be installed separately.
- Hardware-validated matrix rows are tracked in
  `docs/v0_3/PHASE_11_EVIDENCE.md` (`[WINDOWS]`).
- Deep, dense surfaces (Clip Lab, Accuracy Lab) remain English; the i18n
  framework is in place to extend.
