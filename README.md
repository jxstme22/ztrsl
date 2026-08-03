# xTRSNLTR

**Real-time English subtitles for your VALORANT voice chat — 100% local.**

Hear Tagalog, Cebuano, or Chinese callouts, *read* them in English as they happen,
and never send a second of audio to the cloud.

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%2011-7dd3fc" alt="Platform: Windows 11"/>
  <img src="https://img.shields.io/badge/latency-low--latency--local-4ade80" alt="Local low latency"/>
  <img src="https://img.shields.io/badge/privacy-no%20cloud-4ade80" alt="No cloud"/>
  <img src="https://img.shields.io/badge/license-Apache--2.0-dc4d5e" alt="Apache 2.0"/>
</p>

---

## What it does

```
"Rush B!"            xTRSNLTR               "Rush B!" → "Rush B!"
(Tagalog voice)  ─────────────►  (English subtitle on screen)
```

- Listens to **your voice-chat mix** — through a virtual audio cable or any
  audio endpoint you pick.
- Recognizes **Tagalog / Filipino, Cebuano, Chinese, and English**.
- Translates into **English** (Simplified Chinese optional).
- Shows a **transparent, click-through overlay** above your game.
- Handles **multiple channels at once** — `[TEAM]` and `[DISCORD]` lanes, each
  with its own language profile.

It never touches the game: no injection, no memory reads, no automation.
[Why that matters ↓](#safety-first-by-design)

> **Download:** get the Windows installer from
> [GitHub Releases](https://github.com/jxstme22/ztrsl/releases/latest).
> **Status:** beta. It works end-to-end; signing + clean-machine tests are the
> remaining 1.0 work.

---

## How it works (in one picture)

```mermaid
flowchart TB
  subgraph Game
    V[VALORANT voice chat]
  end

  subgraph xTRSNLTR desktop
    C[Audio capture<br/>WASAPI / virtual cable]
    R[16 kHz mono ring buffer]
    O[Transparent overlay window]
    S[Model manager<br/>download + verify]
  end

  subgraph Local inference sidecar
    VAD[VAD + utterance segmentation]
    ASR[Whisper ASR]
    MT[NLLB / MADLAD translation]
    SCHED[Shared priority scheduler]
  end

  V --> C --> R --> VAD --> ASR --> SCHED --> MT
  SCHED --> O
  S -. models .-> ASR & MT
```

**The 30-second version:**

1. Your voice-chat audio is captured from a Windows audio endpoint.
2. A small **VAD** splits the stream into "someone is talking" chunks.
3. **Speech recognition** (local Whisper) turns each chunk into text.
4. **Translation** (local NLLB) turns that into English.
5. A shared **scheduler** keeps finals ahead of drafts and everything bounded.
6. The **overlay** shows it on screen — labeled per source.

Everything runs on your machine. No audio ever leaves it.

---

## VB-CABLE: how voice chat reaches xTRSNLTR

A **virtual audio cable** is a free, user-installed Windows driver that acts as
a "software wire": whatever an app plays to its **Input** can be *captured*
from its **Output**. That's how xTRSNLTR hears exactly the voice-chat mix —
and nothing else.

```mermaid
flowchart TB
  subgraph Your PC
    VC[VALORANT voice chat] --> CI["CABLE Input<br/>(virtual cable)"]
    DC[Discord voice chat] --> CI
    CO["CABLE Output"] --> APP["xTRSNLTR audio core"]
    APP --> HP[("Headphones")]
  end
  GAME[VALORANT game audio] --> HP
```

### Set it up (5 minutes)

**1. Install the cable** — download **VB-CABLE** (free) from
<https://vb-audio.com/Cable/>. Windows will now show a **CABLE Input**
(Playback) and **CABLE Output** (Recording) device pair.

**2. VALORANT voice chat → CABLE Input** — in VALORANT
`Settings → Audio → Voice Chat`, set **Output Device** to **CABLE Input**.
Your teammates' voices now play *into the cable only*.

**3. VALORANT game audio → headphones** — in VALORANT `Settings → Audio`,
keep **Speaker / Output Device** on your **headphones**. Game effects must
never go to the cable, or xTRSNLTR will hear explosions as speech.

**4. Discord voice → the same cable** (or a second one) — in Discord
`Settings → Voice & Video`, set **Output Device** to **CABLE Input**. Route
Discord and VALORANT into the same cable to treat them as one source, or use a
second cable (paid VB-CABLE product) for a separate `[DISCORD]` lane.

**5. Headphones — keep hearing your team** — because voice now plays into the
cable, xTRSNLTR **monitors** it back to you: in xTRSNLTR **Setup**, set the
**monitoring output** to your **headphones** and turn monitoring on. Avoid
echo by letting xTRSNLTR be the *only* path replaying voice to your headset.

**6. Sanity check** — in **Diagnostics**, run **Isolation check**. When only
game sounds play and nobody speaks, the voice capture meter should stay
near-silent. If it jumps, game audio is leaking into the cable.

> VB-CABLE is a **separate install** — xTRSNLTR never bundles, installs, or
> patches the driver; it only detects and routes to it when you choose to.

---

## Caption lifecycle

```mermaid
sequenceDiagram
  participant G as Game voice
  participant S as Sidecar
  participant O as Overlay

  G->>S: audio chunk (16 kHz)
  S->>S: VAD detects speech
  S-->>O: provisional "Listening…" (fast draft)
  G->>S: more audio
  S-->>O: provisional revision ↑ (draft improves)
  G->>S: silence / utterance ends
  S->>O: final caption (stable, replaces draft)
```

Provisionals stream **while** someone talks; the final replaces them the moment
the utterance closes. Multiple sources each get their own lane.

---

## Multi-source, per language

```mermaid
flowchart LR
  A[TEAM channel] --> P1[Tagalog profile] --> O[(Overlay lane 1)]
  B[DISCORD channel] --> P2[Cebuano profile] --> O2[(Overlay lane 2)]
  C[Party channel] --> P3[Mandarin profile] --> O3[(Overlay lane 3)]
```

Each source picks a **language profile** and a **strictness**:

- **Profiles:** Tagalog · Taglish · Cebuano · Bislish · Mandarin ·
  Chinese/English · Auto
- **Strictness:** Off (accept everything) · Balanced (filter clear misses) ·
  Strict (suppress anything off-profile)
- **Tactical callouts** (`rush B`, `rotate A`, numbers) always pass, even under
  Strict — the glossary treats them as data.

---

## Safety first, by design

This project deliberately stays out of the game. It never implements:

- game-process injection, DLL / graphics hooks, or memory reads;
- game-file modification, packet interception, or input automation;
- anti-cheat evasion, kernel drivers, or hidden-data extraction;
- screen analysis for tactical advantage.

It only:

- enumerates ordinary **Windows audio endpoints** and processes local audio;
- draws a normal **transparent top-level window**;
- registers explicit **global hotkeys**;
- stores **user-approved local settings**.

That keeps it outside Vanguard's scope and makes the privacy story simple:
**local in, local out.**

---

## Repository layout

```text
.
├── apps/desktop/           Tauri 2 app — control window + caption overlay
│   └── src-tauri/          Rust host: IPC, audio, sidecar supervision
├── crates/
│   ├── audio-core/         WASAPI capture/playback, resampling, routing
│   ├── model-manager/      verified staged model installs (multi-provider)
│   ├── ipc-protocol/       loopback WebSocket IPC schema
│   ├── sidecar-supervisor/ Python-sidecar lifecycle
│   ├── translation-runner/ Rust (candle) MADLAD-400 runner
│   ├── overlay-core/       caption state machine
│   └── diagnostics/        content-free diagnostics
├── services/inference/    Python sidecar: VAD, ASR, MT
├── scripts/               model installers, build helpers, validation harnesses
├── models/catalog.json    pinned, checksummed download catalog (embedded)
└── docs/                  PRD, architecture, ADRs, phase evidence
```

---

## Getting started (developers)

**Prereqs:** Windows 11 x64 · Node.js 22+ (Corepack) · pnpm · stable Rust ·
Python 3.11–3.13 · `uv`

```powershell
corepack enable
pnpm install --frozen-lockfile
uv sync --extra dev --extra models
```

Run the app:

```powershell
cd apps/desktop
pnpm tauri dev
```

Sanity checks:

```powershell
cargo test -p audio-core -p sidecar-supervisor -p model-manager
cd apps/desktop && pnpm test && pnpm typecheck && pnpm lint
.venv\Scripts\python -m pytest services\inference\tests -q
.venv\Scripts\python -m ruff check services\inference
```

### Models

The app downloads models itself on first run (pinned, checksum-verified, with a
confirmation dialog). Prefer the CLI in development:

```powershell
python scripts/install_models.py whisper-turbo --accept-license
python scripts/install_models.py nllb --accept-license
python scripts/install_models.py madlad --accept-license   # optional, CPU-only
```

Can't reach Hugging Face? The Models tab can use `hf-mirror.com` (or
`LST_REGION=cn`), and offline packs install with zero network.

---

## Model licenses

Models keep their **own** licenses, separate from the project's Apache-2.0 code:

| Model | Kind | License |
|---|---|---|
| faster-whisper large-v3 / turbo | ASR | MIT |
| OmniLingual CTC 300M | ASR | Apache-2.0 |
| NLLB-200 distilled 600M | Translation | **CC-BY-NC-4.0** (non-commercial) |
| MADLAD-400 3B | Translation | Apache-2.0 |

---

## User documentation

- [Setup guide](docs/17_SETUP_GUIDE.md) — includes the VB-CABLE handoff
- [Sources & labels](docs/18_SOURCES_AND_LABELS.md)
- [Language profiles & strictness](docs/19_LANGUAGE_PROFILES.md)
- [Models & downloads](docs/20_MODELS_AND_DOWNLOADS.md)
- [Diagnostics & troubleshooting](docs/21_DIAGNOSTICS_TROUBLESHOOTING.md)
- [FAQ](docs/22_FAQ.md)
- [v0.3.0 release notes](docs/23_RELEASE_NOTES_V0_3_0.md)

## For contributors

- [Contributing](CONTRIBUTING.md) — including the hard safety boundary list
- [Security policy](SECURITY.md)
- Formal design docs in [`docs/`](docs/README.md) — PRD, architecture, ADRs,
  and per-phase evidence.

---

## Roadmap to 1.0

Current release: **v0.3.0** (beta — multi-source). Working toward 1.0:

- [ ] code signing (Windows SmartScreen)
- [ ] clean-machine installer walkthrough (the last hardware gate)
- [ ] native-speaker accuracy benchmarks (Tagalog/Cebuano)
- [ ] opt-in API keys → OS keychain
- [ ] auto-update

## License

Copyright (c) 2026 the xTRSNLTR contributors. Licensed under the
[Apache License 2.0](LICENSE).

*VALORANT is a trademark of Riot Games, Inc. This project is not affiliated
with, endorsed by, or sponsored by Riot Games.*
