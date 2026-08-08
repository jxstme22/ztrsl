# yTRSL v0.9.4 — General-Purpose Release

**Real-time subtitles for VALORANT voice chat — 100% local, plus your own voice and typed chat.**

This release makes model selection honest (only what you can actually use),
fixes the separated-live session (History page) so it reliably captures your
mic, and hardens the typed-chat sidecar against stalls.

---

## What's new in v0.9.4

### Model dropdowns — only what you can use
- Every model picker (Live page and the config dialog) now shows **only
  installed local models plus always-available cloud/API providers**
  (NVIDIA NIM, Groq, LibreTranslate, Baidu, MyMemory, custom HTTP).
- Uninstalled local models are hidden instead of listed as "not installed".

### Separated live session (History page) — fixed
- The you-mic source declares its own translation direction; with a cold
  NLLB model cache the sidecar's provider build could outlast the
  supervisor's 2-second read timeout and silently kill the session ("says
  live but the mic shows nothing"). The registry read now waits up to 3
  minutes.
- Simple **Start / Stop buttons** on the History toolbar.
- **Mic ownership**: while the separated live session is listening it owns
  the mic (captured as a source); the History mic toggle reports it as on.
  Otherwise it falls back to the main Live page's mic toggle.
- The config dialog now has **API-key inputs** for NVIDIA NIM, Groq,
  LibreTranslate, Baidu, and custom HTTP — so cloud backends actually work
  from the separated session (the keys are pushed to the sidecar at start).

### Typed chat — no more stalls
- A wedged chat sidecar used to hold the chat lock during a 5-minute read,
  blocking every later message ("send is stalled"). Chat reads are now
  bounded to 90 seconds, and a failed connection respawns a fresh sidecar.

### Live page — your models persist
- The saved ASR / translation providers (including all `nvidia-*`
  backends) are restored when you return to the Live page instead of
  reverting to the local default.

### UX polish
- Dropdowns auto-close after picking an option (History display-options
  menu included).
- The "input level / waiting for audio" text label is gone (the meter bar
  stays).
- The welcome modal only appears on a fresh install — dismissing it is
  remembered.
- Auto-reverse checkbox removed from the config dialog (the behavior stays
  on by default).

---

## Install

Download **yTRSL_0.9.4_x64-setup.exe** below and run it. The installer
bundles:

- the Tauri desktop app (Windows 11 x64)
- the Python inference sidecar (frozen with PyInstaller)
- the translation-runner binary

Models are downloaded on first use from the Models page (Whisper /
NCSpeech / NLLB / MADLAD — each ~0.3–3 GB, optional CUDA pack ~1.3 GB).

### Requirements
- Windows 11 x64 (Windows 10 may work, untested)
- 8 GB RAM minimum (16 GB recommended)
- **VB-CABLE** (free, vb-audio.com) for game-voice capture — never bundled
- NVIDIA GPU with CUDA 12 for acceleration (optional; CPU fallback works)

---

## Language matrix

| Source (recognize) | Output (translate to) |
|---|---|
| Filipino / Tagalog | English `en` |
| Chinese / Mandarin | Chinese `zh` |
| English | Filipino `fil` |
| Indonesian | Indonesian `ind` |
| Vietnamese | Vietnamese `vie` |
| Thai | Thai `tha` |
| Malay | Malay `zsm` |

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
history. Highlights of the v0.9 series:

- v0.9.3 — source.registry wire fix (1008 close), speaker log lines,
  new-session rotation, light-theme white surfaces
- v0.9.2 — mic late-enable, YOU bubble color, overlay polish
- v0.9.1 — yTRSL branding, titlebar + history polish
- v0.9.0 — you-voice, typed chat, separated live, 7-language matrix
