# Phase 2 Validation Record

Date: 2026-07-30

Status: Non-hardware implementation complete and compile-checked on macOS; Windows hardware
acceptance deferred.

## Acceptance Criteria

- Enumerate Windows capture and render endpoints with stable IDs and friendly names.
- Report endpoint state, default roles, and native sample rate/channel count when available.
- Detect device changes with a bounded, non-blocking notification path.
- Require explicit capture-endpoint selection and persist only its stable ID.
- Display a capture level meter with no monitoring or playback.
- Recover safely from endpoint removal and replug without silently switching devices.
- Provide a deterministic synthetic audio source for model-free tests.
- Keep all queues bounded and keep logging, allocation, locks, and blocking work out of callbacks.

## Implemented Evidence

- `audio-core` defines serializable endpoint, state, format, default-role, and level contracts.
- `BoundedFrameQueue` uses fixed capacity, drops the oldest frame, and counts drops.
- `AtomicLevelMeter` publishes peak/RMS/clipping/drop metrics with atomic operations.
- `SyntheticAudioSource` emits deterministic 20 ms, 48 kHz mono frames and stops immediately.
- Windows Core Audio enumeration uses stable `IMMDevice::GetId` identifiers.
- Windows enumeration includes capture/render endpoints, state, friendly name, default roles, and
  mix format where Windows exposes it.
- Windows endpoint notifications run on a dedicated COM thread, use a capacity-32 channel in the
  desktop runtime, and call only non-blocking `try_send` from the callback.
- Device events trigger full catalog re-enumeration; the UI also refreshes every two seconds.
- The selected endpoint ID is versioned, runtime-validated, and stored locally. No endpoint is
  selected automatically.
- The meter uses deterministic synthetic frames on macOS/browser preview and the ordinary Windows
  endpoint meter interface on Windows.
- The UI explicitly states: capture meter only, no playback, no recording.
- Shutdown stops the synthetic source and joins the Windows notification thread deterministically.

## Automated Evidence

Validation host: macOS development host.

- `cargo check --workspace`: passed.
- `cargo test --workspace`: 14 Rust tests passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo check -p audio-core --target x86_64-pc-windows-msvc`: passed.
- `cargo clippy -p audio-core --target x86_64-pc-windows-msvc -- -D warnings`: passed.
- Full Tauri Windows cross-check reached the platform resource build and stopped because the macOS
  host does not provide `llvm-rc`; Windows CI remains the authoritative integrated compile.
- `pnpm test`: 19 frontend tests passed across six files.
- `pnpm typecheck`: passed with strict TypeScript,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- `pnpm lint`: passed with zero warnings.
- `pnpm build`: production frontend build passed.
- `pnpm --filter @local-squad-translator/desktop tauri build --no-bundle`: optimized integrated
  macOS build passed.
- The optimized desktop process stayed running through startup; macOS emitted expected
  workspace-service sandbox warnings and the process was then terminated manually.

## Failure-Path Evidence

- Zero-capacity queues/watchers are rejected.
- A missing synthetic endpoint is rejected.
- Starting an already-running source is rejected.
- Reading a stopped source is rejected.
- Malformed persisted endpoint selection is discarded.
- A missing selected endpoint stops the UI meter and remains selected for explicit recovery; the
  application does not fall back to another device.
- A disconnected notification worker returns an invalidated-device error.

## Deferred Windows 11 Evidence

- [ ] Capture and render endpoint names/IDs/states are correct.
- [ ] Default console, multimedia, and communications roles are correct.
- [ ] Native sample rate and channel count match Windows Sound settings.
- [ ] A selected virtual-cable capture endpoint shows incoming voice level.
- [ ] No capture endpoint is selected without user action.
- [ ] Removing the selected endpoint does not crash the app.
- [ ] Replugging the same endpoint ID permits recovery.
- [ ] The app never switches silently to speakers or a microphone.
- [ ] Device-state/default/property notifications refresh the catalog.
- [ ] Repeated start/stop and application shutdown leave no background process or hung thread.
- [ ] No audio is played or written to disk.
- [ ] CPU and RAM are recorded while idle and while metering.
- [ ] GPU and VRAM remain unchanged within measurement noise.
- [ ] Screenshot and diagnostic log evidence are attached.

## Resource Measurements

| Metric | macOS synthetic | Windows target |
|---|---:|---:|
| Meter polling interval | 100 ms | 100 ms |
| Endpoint refresh interval | 2 s | 2 s plus notifications |
| Frame duration | 20 ms | Endpoint meter API; no raw frame capture yet |
| Queue capacity | Fixed by caller; notification queue 32 | Pending hardware confirmation |
| CPU | Not recorded as target evidence | Pending |
| RAM | Not recorded as target evidence | Pending |
| GPU / VRAM | Not used by Phase 2 | Pending confirmation |

## Safety and Privacy

This phase uses only ordinary local audio endpoint APIs. It has no game-process access, graphics
hook, memory read, packet interception, game-file modification, input automation, anti-cheat
evasion, kernel component, monitoring playback, model inference, telemetry, or raw-audio
persistence.

## Next Gate

Run the deferred checklist on Windows 11 with the intended virtual cable and headset. ADR-010
records the owner's explicit authorization to develop the synthetic Phase 3/4 slices early; it
does not mark Phase 2 accepted.
