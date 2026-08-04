# 23 — Release Notes

## v0.6.2 — Audio-stall resilience, overlay polish, dark overlay, Chinese UI

- **Audio stall no longer kills the session** — when the capture endpoint
  stops delivering frames (game grabs exclusive mode, device hiccup), the
  app now shows a "Audio paused — waiting for the source" warning instead of
  ending live translation, and recovers automatically the moment audio flows
  again. Threshold raised to 10s.
- **Overlay is always dark** — the caption bar and history panel no longer
  follow the app's light theme (which rendered a white overlay); the overlay
  is dark-styled in both themes.
- **Overlay height control** — Settings → Overlay gained a Height slider
  (5-90% of the screen) alongside width and text size; the history mode now
  respects the text-size slider, and the overlay never shows a scrollbar.
- **Sidebar and window** — History moved to right below Live in the sidebar;
  nav icons and the sidebar are slimmer; the control window defaults to
  960px wide with an 880px minimum so the layout stays clean when narrowed.
- **Full Chinese coverage** — every UI string (404 keys) has a Simplified
  Chinese translation, including the overlay chrome.

## v0.6.1 — URL model installs for any model, captions history

- **Install models from a URL (any model)** — Models → "Install model from
  URL" accepts a zip/tar.bz2 archive or a single model file over http(s).
  When the archive carries an offline-pack `manifest.json`, the manifest
  decides the id/kind/runtime and every artifact is SHA-256 verified.
  Otherwise you supply a model id (known ids like the NCSpeech family, or a
  custom lowercase/dash id), kind (asr/translation) and runtime
  (faster-whisper / ctranslate2 / sherpa-onnx / candle). NCSpeech ids install
  into the sidecar's `artifacts/<id>` layout; custom ids land in the store
  root and appear in a new "Custom (URL-imported)" section with delete and
  reveal actions.
- **Captions history** — the app now keeps the last **10 finalized captions**
  (provisional/"listening" updates are never saved) in a bounded, persisted
  buffer. Every entry is rich: **who's talking** (source display name),
  **what they said** (final translation), **when** (wall-clock time), **which
  audio input** produced it (mic / loopback / system audio), plus a
  low-confidence marker. New **History** page in the app shows the transcript
  with a Clear button; the titlebar's history button toggles the same
  transcript on the always-on-top **overlay window** (a readable panel
  instead of the transparent caption lane). Consecutive duplicate finals
  (VAD overlap) are merged, and the same caption id upserts in place.
- **Translation mode: stream vs per-utterance** — Live → "Translation mode":
  *Stream while talking* (default) shows the live preview that improves as
  the speaker continues; *Wait for utterance end (per chunk)* disables
  provisional captions entirely and translates each finished utterance once,
  so the overlay only ever shows completed chunks.
- **Overlay content mode** — the overlay shows exactly **one** thing at a
  time: the **latest-caption bar** or the **history panel** (last 10 finals).
  Switch with the titlebar button, the new *Toggle caption/history view*
  hotkey (Ctrl+Shift+H by default), or Settings → Overlay content. The
  choice persists across restarts.
- **API keys persist** — the Groq key, LingvaTranslate key, custom
  translation endpoint and key are saved as you type; navigating between
  pages no longer wipes them.

## v0.5.9 — Show model folders, folder picker for offline packs

- **"Show in folder" for installed models and CUDA runtime** — every installed
  model card (including NCSpeech local exports) and the CUDA runtime card now
  have a button that opens the exact folder in Explorer/Finder, so you can see
  what's on disk or back it up without hunting through `%APPDATA%`. The button
  only appears when the folder actually exists, and the command refuses paths
  outside the model directory.
- **Browse… button for the offline model pack field** — instead of typing a
  path into the "Install offline model pack" box, pick the pack folder with
  the native folder dialog.

## v0.5.8 — Light theme, CUDA detection fix, delete runtime packs, bottom gap

- **Light theme (Settings → Appearance)** — a new Dark/Light picker on the
  Settings page. Light keeps the same liquid-glass look (transparent frame,
  acrylic blur, translucent panels) with a light frost tint and dark text.
  The choice is saved and restored on the next launch — no dark flash at
  startup. The overlay caption window is unaffected (captions keep their own
  game-facing style).
- **CUDA detection no longer requires cuDNN** — machines with only a CUDA
  Toolkit (no separate cuDNN install) were shown "Not installed" and offered
  a ~1.3 GB re-download even though Live already ran on CUDA. The system
  check now only requires the Toolkit's own DLLs (cuBLAS/cuBLAS LT/cudart for
  CUDA 12 or 13); the app's own runtime pack still requires cuDNN as before.
- **Delete button for leftover/partial runtime packs** — a "Remove CUDA
  runtime" action now appears whenever anything from the pack exists on disk,
  including a partial download from an interrupted install (previously only a
  fully-installed pack could be removed, so stale ~1.3 GB downloads were
  stuck). When the pack is incomplete the remove and install buttons are both
  shown.
- **Bottom gap on every page** — the last card no longer touches the bottom
  edge when a page is scrolled to the end: the content column now sizes each
  page to its own height so the reserved bottom padding actually applies
  (previously the stretched layout overran it).

## v0.5.7 — Models page matches Live, welcome only on fresh install, close really quits

- **Models page redesigned to match the Live page** — the download-server and
  offline-pack rows are now proper full-width cards with a `card-head` title and
  a comfortable `field` layout (no more cramped rows with the select/input
  hugging the right edge). The GPU acceleration card got the same treatment:
  balanced title row with a status badge, description below, and the action
  button on its own divider line. The Installed / Available / Local exports
  sections each live inside a titled card with a live count, instead of
  floating headings.
- **Welcome card now only appears on a fresh install** — previously it could
  show on every run until dismissed once, and never reappeared once models
  were installed. Now it pops up only while no models are on disk; once you
  have any model installed, the welcome never shows again.
- **Closing the window now really quits the app** — the close button hid the
  window but left the app (sidecar, overlay, audio threads) running in the
  background. The main window now asks Tauri to exit the whole process on
  close, so nothing keeps running after you close it.
- **Windows-only releases** — the release workflow gains a `platforms` input
  (windows / macos / both) so a hotfix can ship the Windows installer without
  waiting on the macOS build.

## v0.5.6 — Windows clippy fix

- Collapsed a nested `if` in the WASAPI loopback capture path that the Windows
  clippy build rejected, keeping the Windows CI green.

## v0.5.5 — GPU detection fix

- Removed the broken CUDA probe that constructed a `ctranslate2.Translator`
  without a model — it always raised and forced CPU on machines that had a
  working CUDA Toolkit. CUDA is now detected via `get_cuda_device_count()`,
  with the runtime pack DLLs loaded in every sidecar before model load.

## v0.5.4 — CUDA detection compiles on Windows

- Fixed a Windows-only build error in the CUDA system detection code path
  (simplified the runtime-pack DLL checks).

## v0.5.3 — fix live-loopback stall + CUDA detection + full Chinese UI

**Fixed: "audio capture stalled: no frames for 3.0s" on loopback capture.** Root
cause found: WASAPI loopback marked a quiet endpoint's buffers `SILENT`, and the
capture worker dropped those buffers without emitting a frame. During normal
voice chat — which is quiet most of the time — the live loop saw zero frames
and after 3 s falsely declared the capture stalled. The fix emits real silence
frames for `SILENT` buffers (matching the microphone path), so a quiet channel
is treated as healthy. The stall message now also explains that quiet is normal
and that the error only fires when the device itself stopped delivering audio.

- **CUDA runtime detection** — the Models page now detects when a CUDA
  runtime is already usable on the system (the app's runtime pack or a CUDA
  12 Toolkit with its DLLs on PATH) and shows "GPU available — no download
  needed" instead of asking for the ~1.3 GB pack.
- **Chinese (Simplified) applied to the whole interface** — the Setup wizard
  (all steps), hotkeys, audio meter, routing/IPC diagnostics, clip lab, model
  download rows, caption overlay empty state, and every remaining label,
  sentence, and description are now translated. Language profiles and proper
  nouns (Tagalog, Cebuano…) stay as-is.

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
