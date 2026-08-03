# 17 — Setup Guide

xTRSNLTR turns live VALORANT voice chat into English subtitles. It runs fully
local: your audio never leaves your machine.

## Requirements

- Windows 11 x64 (Windows 10 x64 is untested but likely works).
- A gaming headset / mic that Windows can see as audio endpoints.
- About 4–6 GB free disk for the recommended model set.
- Optional but recommended for game-audio capture: **VB-CABLE Virtual Audio
  Cable** (separate install — see below).

## One-time install

1. Install xTRSNLTR (see the installer docs). Launch it.
2. On first run, the **Welcome** dialog lists the models you can download.
   Pick the recommended pair: **Whisper Turbo** (speech recognition) and
   **NLLB** (translation). Downloads are pinned, checksum-verified, and happen
   only when you choose them.
3. Open **Setup** and choose a routing mode:
   - **Recommended (VB-CABLE)** — if you installed VB-CABLE, the wizard routes
     your game audio through the virtual cable so only the game/party voice is
     captured, with clean isolation from your music and system sounds.
   - **Advanced** — pick the exact capture and monitoring endpoints yourself.
4. In **Sources**, add your voice channels (e.g. `TEAM`, `DISCORD`), pick a
   language profile per source, and set a label style.

## VB-CABLE handoff (separate install)

xTRSNLTR does **not** bundle VB-CABLE. It is a free virtual audio driver by
VB-Audio Software:

1. Download and install from <https://vb-audio.com/Cable/> (Cable V1 is free;
   follow the installer prompts).
2. Restart xTRSNLTR and re-run Setup — it auto-detects the cable.
3. In your game/voice app, set the playback device to **CABLE Input** and keep
   your headset on your normal output.

xTRSNLTR only *detects and routes to* the cable when you choose it; it never
installs, patches, or modifies the driver.

## Verify

Open **Diagnostics** → **Isolation check** and run it — it confirms no
cross-source leakage. The overlay should show `[TEAM]` and `[DISCORD]`
captions independently.
