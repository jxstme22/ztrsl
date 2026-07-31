# Phase 6 Live Translation Validation

- Date: 2026-07-30
- Host exercised: macOS development host
- Windows target: Windows 11 x64, RTX 4070 Ti (pending physical validation)
- Status: implementation complete; Windows hardware acceptance pending

## Acceptance Criteria

- Ordinary selected Windows capture endpoint streams continuously without game integration.
- A separately selected render endpoint monitors friends’ voice through a bounded route.
- Audio is downmixed/resampled to 16 kHz mono outside the UI thread.
- Stateful Silero VAD closes conversational phrases and bounds long utterances.
- Faster-Whisper large-v3 runs forced-Filipino with one inference job at a time.
- MADLAD translates through a persistent local worker.
- Final captions reach the overlay with content-free queue/latency diagnostics.
- Startup, stop, sidecar failure, invalid endpoints, and missing models are recoverable.
- Raw audio, transcript history, cloud processing, and telemetry remain off.

## Implemented Evidence

- `WindowsAudioCapture` and `WindowsAudioPlayback` use bounded channels, explicit endpoint
  selection, drop/underrun counters, and deterministic stream destruction.
- The live worker has separate resamplers for 16 kHz ASR and the selected monitoring device.
- The authenticated loopback protocol implements `live.start`, bounded binary audio,
  `caption.final`, `live.error`, and `live.stop`.
- Production VAD is stateful Silero v6 on CPU. Energy thresholding is limited to deterministic
  tests and the macOS simulator.
- ADR-012 pins the Tagalog-only V1 decision. The full large-v3 manifest pins an exact revision,
  file size, and SHA-256 for every required artifact.
- The UI requires both a friends’ voice input and a headphones/speakers output before Start,
  exposes loading/listening/error states, and moves engineering tools under Advanced Diagnostics.
- Browser interaction review at 1280×720 found no horizontal document overflow and exercised
  endpoint selection plus Start/Stop.
- A native local-engine smoke test loaded the installed turbo fallback as CPU int8, loaded Silero
  and the persistent MADLAD worker, and correctly emitted no caption for silence in 3.725 seconds.
- The fresh ad-hoc-signed macOS `.app` was copied to `/Applications` and passed
  `codesign --verify --deep --strict`.

## Automated Results

```text
Frontend: 26 passed; ESLint clean; strict TypeScript clean; Vite production build passed
Python:   22 passed; Ruff clean/formatted; strict mypy clean
Rust:     28 unit tests passed; 3 hardware/environment integration tests skipped
Clippy:   workspace/all-targets clean with warnings denied
Windows:  audio-core x86_64-pc-windows-msvc cargo check passed
```

## Deferred Windows Checklist

- [ ] Run `scripts/prepare_windows.ps1 -AcceptModelLicenses`.
- [ ] Confirm CTranslate2 sees the RTX 4070 Ti and loads full large-v3 in CUDA FP16.
- [ ] Record exact GPU model, VRAM, driver, CUDA, and cuDNN versions.
- [ ] Confirm virtual-cable endpoint and real headphones map to the intended devices.
- [ ] Listen for echo, gaps, pitch changes, and unacceptable monitor delay.
- [ ] Unplug/replug each endpoint during a session and confirm a recoverable error.
- [ ] Benchmark p50/p95 ASR, MT, final-after-speech, monitor drops, and underruns.
- [ ] Record peak RAM/VRAM and gameplay average FPS, 1% low, and p99 frame time.
- [ ] Score owner-approved noisy Tagalog/Taglish clips with bilingual review.
- [ ] Measure critical tactical errors and unrelated-script drift.
- [ ] Validate transparent overlay focus/click-through behavior while VALORANT is running.

## Known Blockers and Honest Limits

- The Mac had about 4.5 GB free, so downloading/staging the 3.1 GB full large-v3 artifact there
  would risk filling the disk. Its committed checksum manifest and installer are ready; install it
  on the Windows PC with at least 10 GB free.
- Simultaneous overlapping speakers are not separated. They may produce one uncertain mixed
  caption; V1 does not promise speaker attribution.
- The Windows CPAL bridge currently resolves MMDevice selections by friendly name. Duplicate
  friendly names need physical testing and may require a direct endpoint-ID WASAPI backend.
- The macOS `.app` is a development/private-alpha bundle that still uses the workspace Python
  environment and model directory. A public `.dmg`/`.exe` must freeze/bundle the sidecar runtime,
  sign the installer, and keep models as separately verified downloads.
- DMG creation failed in the restricted Mac build session after the `.app` itself built and signed.
