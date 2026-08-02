# xTRSNLTR — Local Translator Overlay for VALORANT

A **fully local Windows desktop companion** that translates incoming VALORANT
voice chat into on-screen subtitles — with **no game-process access, no cloud,
and no telemetry**.

- Listens to the voice-chat mix routed to a virtual audio cable (or the
  microphone capture stream you choose).
- Recognizes **Tagalog / Filipino, Cebuano, Chinese, and English** speech.
- Translates into **English or Simplified Chinese** (whichever you pick).
- Shows low-latency subtitles in a transparent, click-through overlay.
- **Does not** inject into, read the memory of, automate, or modify VALORANT —
  see [Safety boundaries](#safety-boundaries).

> **Status: beta.** It works end-to-end on Windows, but production hardening
> (code signing, auto-update, keychain, native-speaker benchmarks) is
> still in progress. See the [roadmap](#roadmap-and-release-state).

---

## Features

- **In-app model manager** — no model files ship with the installer. On first
  run you choose which models to download; every download shows a confirmation
  dialog with size, source, and license, verifies SHA-256 checksums, and can be
  cancelled or deleted from the app afterward.
- **Live caption pipeline** — bounded audio capture → VAD segmentation →
  Whisper ASR (Tagalog/Cebuano/Chinese/English) → NLLB/MADLAD or optional
  HTTP translation → provisional/final captions in the overlay.
- **Provisional + final captions** — fast revising draft, then a stable final
  once the utterance ends.
- **Fully offline by default** — local NLLB translation. Opt-in HTTP
  translation providers (Google, MyMemory, LibreTranslate, custom endpoint)
  send only the recognized **text**, never audio.
- **Privacy-first** — no raw audio persistence, no telemetry, loopback-only
  authenticated IPC, redacted logs. Only the publisher's first-run welcome and
  model downloads use the network (pinned public URLs).
- **Global hotkeys, overlay placement memory, monitoring output** with echo
  protection.

## Safety boundaries

This project deliberately stays out of the game. It never implements:

- game-process injection, DLL hooks, or graphics API hooks;
- memory reads, game-file modification, packet interception;
- input automation or anti-cheat evasion;
- kernel drivers or hidden-data extraction;
- screen analysis used for tactical advantage.

It only **enumerates ordinary Windows audio endpoints**, processes **local audio**,
draws an ordinary top-level transparent window, registers explicit global
hotkeys, and stores user-approved local settings.

## Repository layout

```text
.
├── apps/desktop/          Tauri 2 app (control window + caption overlay)
│   └── src-tauri/         Rust host: IPC, audio, sidecar supervision
├── crates/
│   ├── audio-core/        WASAPI capture/playback, resampling, routing
│   ├── model-manager/     catalog + verified staged model installs
│   ├── ipc-protocol/      loopback WebSocket IPC schema
│   ├── sidecar-supervisor/ Python-sidecar lifecycle
│   ├── translation-runner/ Rust (candle) MADLAD-400 runner
│   ├── overlay-core/      caption state machine
│   └── diagnostics/       content-free diagnostics
├── services/inference/    Python sidecar: VAD, Whisper ASR, NLLB/HTTP MT
├── scripts/               model installers, sidecar/build helpers
├── models/
│   ├── catalog.json       pinned, checksummed download catalog (embedded)
│   ├── manifests/         per-model verification manifests
│   └── README.md          model policy
└── docs/                  PRD, architecture, ADRs, phase evidence
```

## Getting started (developers)

Prerequisites: **Windows 11 x64**, Node.js 22+ (Corepack), pnpm, stable Rust,
Python 3.11–3.13, and `uv`.

```powershell
corepack enable
pnpm install --frozen-lockfile
uv sync --extra dev --extra models
```

Run the app:

```powershell
pnpm --filter desktop tauri dev          # from repo root
# or
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

The app downloads models itself at first run (see the welcome dialog). For
development you can also install them with the CLI, matching what the catalog
ships:

```powershell
python scripts/install_models.py whisper-turbo --accept-license
python scripts/install_models.py nllb --accept-license
python scripts/install_models.py madlad --accept-license   # optional, CPU only
```

Optional experimental ASR (dev-only, NCCL/export pipelines): see
`scripts/export_ncspeech_onnx.py` and the docs.

## Model licenses

Model artifacts keep their **own** licenses, separate from this project's code
license (Apache-2.0):

| Model | Kind | License | Notes |
|---|---|---|---|
| faster-whisper large-v3 / turbo | ASR | MIT | OpenAI Whisper weights |
| OmniLingual CTC 300M | ASR | Apache-2.0 | research candidate |
| NLLB-200 distilled 600M | Translation | **CC-BY-NC-4.0** | non-commercial by default |
| MADLAD-400 3B | Translation | Apache-2.0 | ~50 s/caption on CPU |

Because the default translation model is non-commercial, review the model
licenses before any commercial distribution of the full package.

## How it works

```
VALORANT voice chat
      │  (ordinary audio endpoint / virtual cable)
      ▼
 WindowsAudioCapture ──► bounded ring buffer / resampler (16 kHz mono)
      │
      ▼
 Sidecar (Python): Silero VAD → utterance segmentation → Whisper ASR
      │                                              │
      │                                      text (never audio)
      ▼                                              ▼
 provisional/final caption ─► NLLB / MADLAD / opt-in HTTP translation
      │
      ▼
 Tauri overlay window (click-through, always-on-top)
```

IPC is a loopback WebSocket secured with a random per-launch token and
constant-time comparison; audio packets are bounded and never written to disk
unless you enable diagnostic recording.

## Security

See [SECURITY.md](SECURITY.md) for the reporting policy. Highlights:

- No API keys or secrets in the repository; `.env*` is gitignored.
- Keys you enter for opt-in HTTP providers are runtime env vars forwarded to
  the sidecar only for that session (stored in webview localStorage — future
  work will move this to the OS keychain before v1.0).
- Every model download is pinned to a revision and committed SHA-256; nothing
  is downloaded until you confirm.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — including the hard safety boundary
list, the phase workflow, and how to add a model to the catalog.

## Documentation

The formal project docs live in [`docs/`](docs/README.md): PRD, system
architecture, ASR/MT pipeline, data models & IPC, security & Riot compliance,
build plan, phase acceptance evidence, and architecture decision records
(`docs/adr/`).

## Roadmap and release state

Current release state: **beta** (functional end-to-end; not yet production).

Remaining for a 1.0 release:

- [ ] code signing (Windows SmartScreen) and a tested NSIS/MSI installer;
- [ ] package the Python sidecar via PyInstaller into the installer
      (script: `scripts/build-sidecar.mjs`, see `docs/adr/ADR-012-packaging.md`);
- [ ] native-speaker benchmarks for Tagalog/Cebuano accuracy;
- [ ] move opt-in API keys to the OS keychain;
- [ ] auto-update pipeline;
- [ ] clean-machine install tests.

The on-disk model manager, in-app picker with confirmation modal, delete
support, and the embedded download catalog are already in place
(see `docs/adr/ADR-011-model-manager.md`).

## License

Copyright (c) 2026 the xTRSNLTR contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use the files in this repository except in compliance with the
License. You may obtain a copy at <http://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations.
