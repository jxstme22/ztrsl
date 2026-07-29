# Phase 1 Validation Record

Date: 2026-07-30

Status: Implemented on macOS; Windows acceptance deferred.

## Acceptance Criteria

- Separate ordinary Tauri overlay window.
- Transparent and topmost behavior.
- Click-through play mode and interactive edit mode.
- Caption updates do not request focus.
- Fake provisional and final captions.
- Configurable global hotkeys with conflict feedback.
- Normalized multi-monitor position storage and off-screen recovery.
- Tests for reducer transitions, stale revisions, expiration, and position normalization.

## Safety Scope

The overlay is an external top-level window owned by this application. This phase does not access
game processes, memory, files, packets, graphics APIs, inputs, audio endpoints, or models.

## Deferred Windows Evidence

- [ ] Overlay appears over Notepad.
- [ ] Overlay appears over a borderless test window.
- [ ] Caption updates never change the foreground window.
- [ ] Play mode is click-through and non-activating.
- [ ] Edit mode is interactive and draggable.
- [ ] Emergency and configured global hotkeys work and conflicts are reported.
- [ ] Overlay recovers from a missing or disconnected display.
- [ ] Mixed-DPI and multi-monitor placement remains visible.
- [ ] Alt+Tab, Windows key, taskbar, and display reconnect behavior are acceptable.

These checks must be run on Windows 11 and are not inferred from macOS behavior.

## Automated Evidence

Validation host: macOS development host.

- `pnpm format:check`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: passed with strict TypeScript,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- `pnpm test`: 14 tests passed across four test files.
- Reducer coverage includes provisional/final transitions, stale revisions, final terminal state,
  deterministic expiration, reading-duration clamps, and the two-caption display bound.
- Placement coverage includes normalized persistence, safe bounds, and missing-monitor recovery.
- Storage coverage rejects malformed/out-of-range settings and confirms no transcript/audio history
  is persisted.
- `pnpm build`: production frontend build passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo test --workspace`: 10 tests passed.
- `pnpm --filter @local-squad-translator/desktop tauri build --no-bundle`: optimized integrated
  Tauri build passed.
- The optimized desktop binary launched on macOS without startup errors and was then terminated
  manually.

## Implemented Behavior

- The overlay is a second transparent, frameless, topmost Tauri window and starts hidden.
- Play mode disables pointer events and makes the native window non-focusable.
- Edit mode enables pointer interaction and native dragging but never calls a focus API.
- Caption IPC-style events are runtime-validated with bounded Zod schemas.
- Fake captions revise twice, finalize, and expire using reading duration.
- The active caption list never exceeds two entries.
- Six configurable global hotkeys are local-only and report invalid/conflicting registration.
- Settings are versioned and persist only appearance, placement, and hotkey configuration.
- Monitor coordinates are normalized to work areas; a missing display recovers to the primary.
- The control UI includes empty, error/retry, recovery, and save-confirmation states.

## macOS Manual Evidence

- [x] Optimized desktop process starts without a native startup error.
- [ ] Visual review at 375 px, 768 px, and 1280 px.
- [ ] Overlay drag, hotkey, and click-through interaction review on macOS.

The headless Chromium visual-review attempt was blocked by the current macOS process sandbox, so
these items remain explicit rather than inferred from compilation.

## Next Gate

Phase 1 is not accepted until the Windows evidence above is recorded. The owner explicitly
authorized the macOS-testable Phase 2 slice under ADR-009; this does not convert any deferred
Windows evidence into a pass.
