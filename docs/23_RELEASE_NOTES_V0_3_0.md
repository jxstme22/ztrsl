# 23 — Release Notes (v0.3.0)

## Multi-source voice translation

xTRSNLTR v0.3.0 is the multi-source release: it translates several voice
channels at once into English subtitles, with per-source language handling and
a source-aware overlay.

## New in v0.3.0

- **Multi-source capture** — concurrent endpoint/process captures with
  immutable source ids; renaming a source never interrupts its stream.
- **Setup wizard** — VB-CABLE-aware routing (recommended / advanced modes).
- **Per-source VAD** — independent utterance state per source.
- **Shared inference scheduler** — one bounded queue set across sources;
  finals always beat provisionals, overload is explicit and measurable.
- **Language profiles + strictness** — per-source Tagalog/Taglish/Cebuano/
  Bislish/Mandarin/Chinese-English/Auto with Off/Balanced/Strict, tactical
  callout bypass, and honest capability labeling.
- **Source-aware overlay** — two caption lanes, all label styles, simultaneous
  policies, hide-source, and XSS-safe tag rendering.
- **Provider-neutral models** — HuggingFace / hf-mirror / ModelScope failover,
  offline pack install, signed catalogs, capability + VRAM metadata.
- **Diagnostics** — scheduler + per-source + language-filter metrics,
  isolation check, and content-free support-bundle export.

## Not included

- This is not an endorsement of or by Riot Games.
- No game-process injection, memory reads, file modification, packet
  interception, or input automation — by design.

## Known limitations

- Windows 11 x64 is the target platform; other platforms are development-only.
- VB-CABLE must be installed separately.
- Some optional models (MADLAD 3B) are CPU-heavy; recommended defaults avoid
  them.
- Hardware-validated matrix rows (device hotplug, process attach/detach,
  long-stability runs) are tracked in `docs/v0_3/PHASE_11_EVIDENCE.md`.
