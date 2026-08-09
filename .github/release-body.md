# yTRSL v0.9.5 — History Mic Fix

**Real-time subtitles for VALORANT voice chat — 100% local, plus your own voice and typed chat.**

This release fixes the History page's mic toggle so it actually controls the
separated (your-voice) session, and makes using the **same audio source on
both pages** safe.

---

## What's new in v0.9.5

### History mic toggle actually works
- The History page's mic button previously did **nothing** while the
  separated live session was listening (it silently echoed the main Live
  page's mic state) — "turn on the mic but send nothing".
- Now the separated session owns a **real gated mic capture**: the button
  flips it on/off through a dedicated `set_separated_live_mic_enabled`
  command, and the mic starts **enabled** when the separated session
  starts.
- The button shows the separated session's true mic state (not the main
  live's).

### Same audio source on both pages is safe
- If the Live page and the History page use the **same microphone**, the
  device is no longer opened twice:
  - mic-only sessions (the separated live) route through the gated mic
    capture instead of synthesizing a fake "TEAM" source;
  - the you-mic source only opens while its toggle is on.
- WASAPI shared mode still allows both sessions to capture the same device
  independently — each session now captures only while its own mic toggle
  is on.

---

## Install

Download **yTRSL_0.9.5_x64-setup.exe** below and run it. The installer
bundles the Tauri desktop app, the frozen Python inference sidecar, and the
translation-runner binary. Models are downloaded on first use from the
Models page.

### Requirements
- Windows 11 x64 (Windows 10 may work, untested)
- 8 GB RAM minimum (16 GB recommended)
- **VB-CABLE** (free, vb-audio.com) for game-voice capture — never bundled
- NVIDIA GPU with CUDA 12 for acceleration (optional; CPU fallback works)

---

## Safety

- No game-process access, memory reads, injection, input automation, or
  anti-cheat evasion — by design.
- No cloud audio by default: everything runs locally. Optional remote
  providers (Groq ASR, NVIDIA NIM, translation APIs) only send text/audio
  when you explicitly enable them with your own API key.

---

## Full changelog

See `docs/23_RELEASE_NOTES.md` in the repository for the complete v0.9.x
history:

- v0.9.4 — installed-only model dropdowns, mic ownership, provider
  persistence, separated-live registry timeout, chat stall fix
- v0.9.3 — source.registry wire fix (1008 close), speaker log lines,
  new-session rotation, light-theme white surfaces
- v0.9.2 — mic late-enable, YOU bubble color, overlay polish
- v0.9.1 — yTRSL branding, titlebar + history polish
- v0.9.0 — you-voice, typed chat, separated live, 7-language matrix
