# 23 — Release Notes (v0.4.1)

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
- Deep, dense surfaces (Clip Lab, Accuracy Lab, Diagnostics) remain English;
  the i18n framework is in place to extend.
