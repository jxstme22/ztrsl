# v0.3 Bug Fixes + UI/Polish + Chinese Interface

**Status:** ☑ complete

This log documents the fixes and refinements made after real-use testing of
v0.3. Each section lists the symptom, root cause, the fix, and how it was
verified.

---

## 1. Bug: "model manifest is missing or invalid" on live start

**Symptom (user report):** Starting live translation failed with
`Live translation could not continue — live translation failed: model manifest
is missing or invalid`, and the sidecar never became ready. Unclear whether the
sidecar or the model download was at fault.

**Root cause (deep check):** A **layout mismatch between the two model install
paths**.

- The CLI (`scripts/install_models.py`) installs models into
  `LST_MODEL_DIR/artifacts/<model-id>`.
- The **in-app Rust model installer** (`crates/model-manager`) installs into
  `LST_MODEL_DIR/<model-id>` (no `artifacts` nesting).
- The sidecar only ever looked in `LST_MODEL_DIR/artifacts/<model-id>`, so
  models downloaded through the app (the normal Windows path) were reported as
  "manifest missing or invalid", and the sidecar could not reach the ready
  handshake — hence the timeout.

The manifest **format** was already compatible (Rust writes
`artifacts: [{ path, size_bytes, sha256 }]`, which `verify_manifest` reads);
only the directory resolution disagreed.

**Fix:** `services/inference/src/local_squad_inference/sidecar.py` — new
`_model_artifact_dir(model_id)` resolver that checks, in order:
1. `LST_MODEL_DIR/artifacts/<model-id>` (CLI layout), then
2. `LST_MODEL_DIR/<model-id>` (in-app layout).

All provider constructors (`local_whisper_provider`, `local_translation_provider`,
`madlad_translation_provider`, `local_ncspeech_provider`, `_whisper_model_dir`)
now resolve through it.

**Verified:**
- New unit test `test_model_artifact_dir_resolves_both_layouts`
  (`test_sidecar.py`): both layouts resolve; a missing model falls back to the
  artifacts path for a clean error.
- Manual probe with a Rust-layout temp model dir resolved correctly.

---

## 2. Bug: Clip Lab requires FFmpeg for new users

**Symptom (user report):** New users cannot try the Clip Lab until they install
FFmpeg.

**Root cause:** `FfmpegDecoder` is the only decoder; it raises `MediaError` when
`ffmpeg`/`ffprobe` are absent, so no clip can run without an FFmpeg install.

**Fix:** Added a **pure-Python `WaveDecoder`** in `media.py` for 16 kHz / 16-bit
PCM WAV files — no FFmpeg required. `process_clip` now uses it automatically
for `.wav` files and falls back to FFmpeg only when the WAV cannot be decoded by
the built-in path (so existing MP4/MKV/MP3 support is unchanged).

**Verified:**
- `test_wave_decoder_reads_16khz_pcm_wav` — decodes a WAV and yields audio.
- `test_wave_decoder_rejects_wrong_sample_rate` — non-16 kHz raises a clear
  error (and the clip pipeline falls back to FFmpeg).

---

## 3. Bug: VB-CABLE not detected even though it is installed

**Symptom (user report):** The setup wizard says VB-CABLE is not installed even
after the user installed it.

**Root cause:** **Swapped endpoint kinds.** VB-CABLE installs:

- **"CABLE Input"** — a RENDER (playback) endpoint (apps/games play voice INTO it);
- **"CABLE Output"** — a CAPTURE (recording) endpoint (the app records FROM it).

`detectVbCable` looked for a *capture* named "CABLE Input" and a *render* named
"CABLE Output", which never matched on a real Windows machine. (WASAPI assigns
`eCapture` → `EndpointKind::Capture`, `eRender` → `EndpointKind::Render`, so
the catalog is correct — the detector's assumptions were wrong.)

**Fix:** `apps/desktop/src/setup/vbCable.ts` — corrected the kind matching
(CABLE Input → render, CABLE Output → capture). Tests updated to the real
WASAPI kinds.

**Verified:** `vbCable.test.ts` (5) — both endpoints active → installed; missing
one → not installed; disabled → degraded; unrelated devices ignored.

---

## 4. UI refinement

### 4.1 Welcome card is off-brand ("AI slop")

**Problem:** The welcome dialog used blue/green accents
(`#5ec9f2`, `#6fe3b0`), a blue→green gradient top bar, and hardcoded colors —
inconsistent with the Black Ember brand (warm red `#dc4d5e`, near-black glass
surfaces).

**Fix** (`styles.css`):
- Replaced the gradient accent, mark icon, step numbers, badge, progress fill,
  and spinner with the brand primary (`--primary: #dc4d5e`) and design tokens
  (`--glass`, `--stroke`, `--radius-*`).
- Defined `--primary` in `:root` so the brand color is a real token.
- Welcome dialog surface now matches the `.card` pattern.

### 4.2 Models tab/cards messy

**Fix** (`styles.css` + `ModelsPanel.tsx`):
- Cards now use `--glass`/`--stroke`/`--radius` with a hover state (matching
  the rest of the app) instead of hardcoded `rgba(255,255,255,…)` tints.
- Section headings use the muted design token.
- Capability/VRAM/recommended-profile metadata rendered as clean `.lst-capability`
  pills on a separated row instead of a run-on `·` list.

### 4.3 Dropdown inconsistency (new tabs vs live page)

**Problem:** The Settings page used native `<select>` elements while the rest of
the app uses the custom `Select` component, so dropdowns looked different.

**Fix** (`ControlApp.tsx`): Replaced the native selects (Simultaneous captions,
Primary source) with the shared `Select` component. The color swatch input now
uses styled `-webkit/moz-color-swatch` borders to match the field pattern.

### 4.4 Footer too close to the bottom

**Fix** (`styles.css`): `.content` bottom padding increased from `26px` to
`40px` so the last card has breathing room above the window edge.

---

## 5. Chinese (Simplified) interface

**Goal:** Chinese speakers should not have to translate the English interface.
Language is chosen **before first use on the welcome card** and can be changed
anytime in Settings.

**Implementation** (`apps/desktop/src/features/i18n/`):
- `strings.ts` — a typed `UIString` catalog (`{ en, zh }`) for every key; a
  `translate(key, language)` helper; `UiLanguage = "en" | "zh"`.
- `storage.ts` — persisted language (`local-squad-translator.ui-language.v1`).
- `useUiLanguage.ts` — hook exposing `{ language, setLanguage, t }`.
- **Welcome card:** an "Interface language" picker is shown at the top, and the
  welcome title, steps, model picker, and buttons translate live.
- **Settings:** a new "Interface language" card at the top of Settings, plus
  translated nav, overlay-appearance, hotkeys, sliders, and reset labels.

**Scope:** The primary surfaces (nav, welcome, settings, common actions) are
fully translated. Deep, dense surfaces (Clip Lab, Accuracy Lab, diagnostics)
remain English for now — the framework is in place to extend.

**Verified:**
- `strings.test.ts` (8) — every key has both languages, Chinese welcome title,
  welcome-card coverage, storage round-trip + invalid fallback.
- `WelcomeModelsDialog.test.tsx` (2) — English default and Chinese render.

---

## Checks

- Python: `183 passed, 1 skipped`; ruff check + format clean.
- Rust: workspace tests pass; clippy 0 warnings; fmt clean.
- Desktop: `187 passed`; typecheck + lint clean.
