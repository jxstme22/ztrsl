# 23 — Release Notes

## v0.8.1 — history sessions, CTA-styled UI (feat/general-purpose-v0.8)

Follow-up to v0.8.0 with the history rework and the UI polish pass:

- **Session-scoped transcripts** — History is now grouped into sessions
  instead of a fixed ring: a session opens when Live starts, stays open
  when you choose "Keep open" on stop (the next Start appends to it), and
  ends when you confirm "End session". The stop button now asks first.
  Sessions can be picked, renamed, deleted, and cleared; the whole list
  persists. The overlay history shows the current session's transcript.
- **History display options** — one Settings menu on the History page
  toggles transcribed input, speaker, timestamps, latency, and model
  badges; per-entry copy button; search box. Latency is the sidecar's real
  capture→caption time.
- **Caption segmentation styles** — chunk, balanced, sentence.
- **CTA button recipe** — primary actions (live start, end session, wizard
  next, install, accuracy run) and the sidebar active icon wear a gradient
  button with a soft glow, ring outline, 1px press, and a 550ms diagonal
  shine sweep (blue in light theme, orange shading in dark). The titlebar
  brand card uses the same recipe.
- **Cramped selects fixed** — Clip Lab and Accuracy Lab source-speech /
  configuration options use short labels (Tagalog-first, Filipino, Cebuano,
  Chinese; Recommended) so the cards stop over-widening.
- **Setup wizard page, Profile page, About page, sidebar reorder** — the
  wizard is now a Profile page with inline live layout and a sticky history
  toolbar; app renamed yTSRL→yTRSL.

## v0.8.0 — general-purpose release (feat/general-purpose-v0.8)

First release of the generalization train — the build plan
(`yTRSL_DEEPSEEK_BUILD_PLAN.md`) shipped in full. Key highlights:

- **Language routing** — source-language routing matrix with per-source
  modes; unknown languages are gated honestly (DEC-001: never a silent
  fallback to an unrelated language).
- **Setup wizard** — capture-mode selection, VB-CABLE pairing, signal
  test, per-use-case profiles (gaming/streaming/meetings), recovery
  guidance.
- **Presets & quality** — catalog presets, quality profiles
  (Fast/Balanced/Best quality/Low memory), Advanced provider config.
- **Audio health & VAD** — energy/silero diagnostics, VAD profiles
  (fast callouts / natural conversation / meeting), audio normalization
  policies.
- **Recognition router** — hardware capability detection, per-provider
  routing, Paraformer/SenseVoice honesty (no silent wrong-language
  output), graceful fallbacks.
- **Vocabulary & context** — context manager, vocabulary packs, hotwords,
  preservation lists.
- **History & exports** — stronger history, TXT/JSON/SRT/VTT/MD exporters.
- **Reliability** — caption SSE stream (`LST_CAPTION_STREAM_PORT`),
  performance budgets, release gate (`scripts/check_release_gate.py`).
- Cloud endpoints: NVIDIA Parakeet CTC 1.1B ASR + Riva 4B + Baidu
  Translate (working free endpoints), plus the live-pipeline provisional
  fixes from v0.7.4.

## v0.7.2 — NVIDIA NIM cloud providers (feat/side)

- **NVIDIA ASR endpoints (build.nvidia.com)** — Whisper large-v3, Nemotron
  ASR streaming, Parakeet CTC 1.1B, and Canary 1B are selectable ASR
  providers. One free `nvapi-…` key unlocks all of them; audio is sent to
  NVIDIA only while an NVIDIA option is selected. Parakeet/Canary reject
  unsupported source languages with a visible error (never a silent
  fallback).
- **NVIDIA Riva translation** — Riva Translate 4B Instruct and Riva
  Translate 1.6B via the OpenAI-compatible chat gateway, prompted with the
  chosen target language.
- **UX: only installed models + free endpoints** — the Live panel now
  hides local models that are not downloaded and always shows the
  cloud/free endpoints (Groq, NVIDIA NIM, translation APIs), so the list
  reflects what can actually run.

## v0.7.1 — History page shows the transcribed input

- **Transcribed input toggle on the History page** — a checklist button next
  to Clear lets you show the recognized (source-language) text under each
  translation, so you can compare what was said with what was translated.
  Off by default; your choice persists. The overlay is unchanged — the
  caption lane keeps showing only the translation.

## v0.7.0 — Multi-source live, mainland-China downloads, rebranded title bar

- **Multi-source live sessions** — the Live page gains a Capture mode
  toggle: **One channel** (single device) or **All sources**. All-sources
  starts one live session that captures every source configured on the
  Sources page simultaneously, each with its own device, VAD timing and
  caption tag — captions come out tagged per source (e.g. "TEAM", "MIX")
  and History groups them per source. Per-source language profiles and
  priorities are respected; monitoring is unavailable in all-sources mode.
- **Mainland-China downloads fixed** — FunASR Paraformer zh (streaming) and
  OmniLingual CTC 300M were hosted only on GitHub releases (unreachable in
  mainland China → "transport error: error decoding response body"). Both
  now download file-by-file from the official sherpa-onnx Hugging Face
  mirrors (byte-identical, checksum-verified), so the hf-mirror → modelscope
  failover chain works.
- **Rebranded title bar** — app renamed to **yTRSL**; the title bar now
  shows one rounded brand card — `yTRSL (BETA) v0.7` — white text on dark
  mode, black text on light mode. Title bar height and sidebar icons
  tightened.
- **Models page can no longer be blanked by a stale capability value** — a
  URL-imported (custom) model carrying an out-of-contract capability
  previously failed schema validation and took down the whole models list.
  The frontend now falls back to the conservative defaults (`post-filter` /
  `low`) instead of failing; regression test covers the legacy payload.
- **New app icons** — the full icon set is regenerated from the new artwork.

## v0.6.12 — Fix: 10054 crash on SenseVoice/Paraformer/opus-mt (Windows)

- **Root cause found and fixed.** The new models crashed the sidecar
  ("connection forcibly closed" / error 10054) because Windows resolved
  `onnxruntime.dll` from a stale 1.17.1 copy in `C:\Windows\SYSTEM32`
  (installed by other software) ahead of the app's 1.27.0 copy; sherpa-onnx's
  binding (built for onnxruntime API 27) then died with an access violation
  on the first model load. The sidecar now preloads its own onnxruntime DLL
  by full path before any model import, so the correct 1.27.0 build is always
  used; the bundled 1.17.1 copy shipped inside sherpa-onnx-core is also
  replaced at package time.
- **Verified on Windows CI** — a new smoke workflow downloads the real
  models and runs the actual providers on a Windows runner: SenseVoice
  decodes, Paraformer loads and decodes, opus-mt en→zh translates.
- **Windows smoke harness** — `.github/workflows/smoke-models.yml` +
  `scripts/ci_smoke_models.py` reproduce model loads on Windows runners for
  every future model change.

## v0.6.11 — opus-mt zh→en, CUDA float16 inference, overlay self-hiding, crash traces

- **Helsinki opus-mt (zh→en)** — new installable model for Chinese→English
  translation (~158 MB, Apache-2.0, CTranslate2 int8 conversion of
  Helsinki-NLP/opus-mt-zh-en). Live panel entry with an English-output
  constraint, sidecar + protocol + desktop wiring end to end.
- **opus-mt best-quality inference** — on CUDA the opus-mt models now run
  dequantized **float16** inference (near-full-precision quality); CPU keeps
  int8. Both directions (en→zh, zh→en). The int8-quantized weights are the
  only published CTranslate2 format of the Helsinki models, so quality is
  delivered at inference time rather than through unverifiable "float16"
  repos (checked: the hosted "float16" conversions are byte-identical int8).
- **Overlay never shows at startup and always hides on command** — the
  overlay window now controls its own visibility: it hides on mount and on
  every snapshot, so hiding works even if the control window's handle to it
  misbehaves, and it can no longer appear on app open.
- **Installed model cards** — the loud green border/tint is replaced by a
  softly shaded surface (top-lit gradient, inner highlight, soft shadow).
- **Sidecar crash traces** — the sidecar enables `faulthandler` and the
  supervisor captures its stderr; when the inference process dies
  mid-session (error 10054), the auto-restart warning now includes the crash
  trace so failures self-report.

## v0.6.10 — Live session auto-recovery, overlay transparency + dismiss fixes

- **Live sessions survive sidecar crashes** — when the local inference
  sidecar dies mid-session (the Windows "connection forcibly closed by the
  remote host" / error 10054), the desktop worker now restarts the sidecar
  in place, renegotiates the session and keeps captions flowing, with a
  warning instead of ending the session. Sidecar hiccups it flags as
  recoverable (`live.error` with `recoverable: true`) surface as warnings
  while the session keeps listening.
- **Fix: overlay black block gone** — removed the CSS rule that painted the
  whole overlay window solid dark; the caption lane renders as the
  transparent bar again.
- **Fix: hiding the overlay sticks** — after hiding (button or hotkey), new
  captions no longer force the overlay back open; use the show button or
  hotkey to bring it back.

## v0.6.9 — Fix: live start with new ASR/MT providers, overlay window restored

- **Fix: "unknown ASR provider" on live start** — the desktop's live-start
  validation was not updated for the new providers, so starting a live
  session with SenseVoice, Paraformer, or opus-mt was rejected before it
  reached the sidecar. The allowlist now accepts `sensevoice-small`,
  `sense-voice`, `paraformer-zh-streaming`, `mlx`, `mlx-whisper` (ASR) and
  `opus-mt-en-zh` (translation).
- **Fix: overlay window was an opaque black block** — v0.6.8 accidentally
  dropped the overlay window's `transparent` flag, so the caption lane
  rendered as a solid black rectangle over the game. Transparency is
  restored; the overlay looks and behaves like v0.6.7 again.
- **Fix: overlay visibility after dismiss** — reverted to the v0.6.7
  behavior where a caption re-shows the overlay after it was hidden.

## v0.6.8 — Three new downloadable models, two-column Models page

- **FunASR Paraformer zh (streaming)** — a new downloadable STT model on the
  Models page: streaming Paraformer (Mandarin/English) via sherpa-onnx
  (`paraformer-zh-streaming`, Apache-2.0, ~1 GB archive, int8). Pins the
  sherpa-onnx ONNX export of the FunASR weights.
- **SenseVoice Small** — multilingual ASR (zh/en/ja/ko/yue) with auto
  language detection and inverse text normalization via sherpa-onnx
  (`sensevoice-small`, Apache-2.0, ~239 MB int8). ONNX export of the
  FunAudioLLM/SenseVoiceSmall weights, revision-pinned and SHA-256 verified.
- **Helsinki opus-mt (en→zh)** — a new local English→Chinese translation
  model (`opus-mt-en-zh-ct2-int8`, Apache-2.0, ~158 MB, commercially usable;
  NLLB is CC-BY-NC). Official CTranslate2 int8 conversion of the Helsinki
  model. English source + Chinese output only, enforced in the UI and the
  sidecar.
- **Models page now uses a two-column grid** for installed, available,
  custom, and local-export sections (single column on narrow windows).
- New provider entries in the Live panel for the three models; the sidecar
  accepts them end-to-end.
- Sidecar packaging includes the `sentencepiece` dependency; the overlay
  window keeps its transparent caption lane; overlay hotkey dismiss behavior
  fixed (hiding the overlay with the hotkey stops captions from re-showing it).

## v0.6.7 — Setup wizard removed, audio sources on the Sources page

- **The 11-step setup wizard is gone.** All of its functionality now lives on
  the Sources page, which was already the better surface for it.
- **Audio source pickers moved into each source card.** Every source now
  chooses its voice input directly: microphones (including VB-CABLE's
  CABLE Output) and loopback endpoints ("game / teammate mix — no mic"),
  plus the optional monitoring toggle, headphone output, and blend controls.
- **VB-CABLE availability card at the top of the Sources page** (Windows
  only) — shows a "VB-CABLE detected" pill when CABLE Output/Input are
  present, or a "VB-CABLE not detected" pill with the routing guide
  (VALORANT game output → CABLE Input, voice chat → CABLE Output) and a note
  that VB-CABLE is installed separately from vb-audio.com.
- **"Captions history (last 10)" label fixed** — the overlay content option
  no longer claims a fixed 10-row history; it is just "Captions history"
  (rows are configurable since v0.6.5).
- Wizard-only strings and code removed (~70 dead i18n keys, ~17 dead tests);
  207 frontend tests and 194 sidecar tests green.

## v0.6.6 — Cleaner chat: audio-source labels removed

- The audio-input label ("Audio: …" / loopback names) is no longer shown in
  the overlay chat or the History page — the transcript is just speaker,
  text, and time.

## v0.6.5 — Overlay chat fixes, row cap, no scrollbars

- **Chat order is now reliable.** The overlay history list renders newest
  first with a reversed flex column, so the latest translation is always
  pinned to the bottom — no more scroll anchoring that could land mid-list.
- **Background transparency now works in the history panel.** The opacity
  slider (Live → Customize overlay) previously only affected the caption
  lane; the history panel was hardcoded to 86% opacity. It now follows the
  slider.
- **History row cap.** Choose Default (auto), 10 rows, or 5 rows for the
  overlay chat; fixed caps size the panel to its content and pin it to the
  bottom.
- **Scrollbars removed from the overlay window entirely** — the overlay
  document cannot scroll and never draws a scrollbar (overflow is reachable
  by wheel/touch only).

## v0.6.4 — Fix: new target languages rejected by the sidecar

- **Hotfix for "sidecar connection closed: 1008 invalid message"** — the
  sidecar's `live.start` payload still restricted `target_language` to
  `en`/`zh`, so selecting Filipino, Indonesian, Vietnamese, Thai or Malay as
  the output language failed pydantic validation and the sidecar closed the
  connection with 1008. The payload now accepts all seven target languages
  (regression test added; 194 sidecar tests green).

## v0.6.3 — Move overlay mid-session, 7-language matrix, overlay polish

- **Move the overlay while captions are flowing** — Live → Customize overlay
  → "Move overlay": drag the overlay anytime during a live session, then
  click "Done" on the overlay; placement persists and click-through returns.
  Snapshot syncs no longer fight an in-progress drag.
- **Overlay settings moved to the Live page** — the overlay appearance
  controls now live on Live under a "Customize overlay" dropdown (Show/Hide
  options); the Settings page's overlay card is gone.
- **Seven-language matrix (both directions)** — source languages: Filipino,
  Chinese, English, Indonesian (Bahasa), Vietnamese, Thai, Malay; target
  languages: English, Chinese, Filipino, Indonesian, Vietnamese, Thai,
  Malay. NLLB tokens, Whisper codes and HTTP provider codes all mapped; the
  full sidecar suite (193 tests) passes.
- **History is chat-ordered** — newest captions appear at the bottom of the
  History page and the overlay history panel (which auto-scrolls to the
  latest line); per-source accent colors now tint each speaker's badge and
  edge bar.
- **Sidebar + window sizing** — sidebar widened to 64px with 44px buttons
  and 22px icons; the control window defaults to 1000px (min 920).
- **Clean BETA badge** — plain foreground-colored "BETA" text (white on
  dark, black on light) instead of the cyan pill.

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

## v0.9.0 — you-voice, chat, separated live, 7-language matrix (feat/general-purpose-v0.8)

The Windows general build picks up the full feature train from the macOS port,
minus macOS-only pieces (window chrome, system-audio capture, MLX, mic TCC).

- **Your voice on the same live session** — a "you" mic stream rides the live
  pipeline: pick your mic + language pair in the history input-card config,
  tap the mic button, and your own speech is transcribed and translated in the
  reverse direction (default: auto-reverse of the live pair) into right-aligned
  "you" bubbles. The mic opens/closes around the toggle — nothing is captured
  while off.
- **Typed chat translation** — a chat box on the History page translates typed
  messages on demand (standalone; no live session needed) into "you" bubbles
  you can copy and spell out. Works with the same language pair.
- **Separated live** — a second, independent live translation started from the
  History page with its own endpoint/models. It shares the sidecar process with
  the main live session, so loaded models (whisper/NLLB) are reused — only
  genuinely-different models load twice — and both sessions record into the
  same history transcript.
- **Chat-room history** — bubble layout with profile icons and per-source
  colors (toggleable), same-speaker message merging, per-message copy,
  auto-scroll to newest, a session sidebar column (latest on top), and a
  Classic-list layout (the default) with "you" entries right-aligned.
- **7-language matrix** — Filipino, Chinese, English, Indonesian, Vietnamese,
  Thai, Malay sources → en/zh/fil/ind/vie/tha/zsm targets via NLLB,
  opus-mt en↔zh, plus NVIDIA NIM ASR (Parakeet/Nemotron/Canary/Whisper) and
  Riva translation, and Baidu Translate.
- **Sidecar reliability** — per-utterance provisional latch (no more "stuck
  mid-phrase"), no provisional decodes for remote ASR, crash-restart recovery,
  and the shared-process model cache.
- **Responsive dropdowns** — selects flip upward near the viewport bottom;
  history menus are solid; settings menu redesigned with checkmarks and a
  nested layout picker.
- **Branding** — yTRSL on the Windows build.
