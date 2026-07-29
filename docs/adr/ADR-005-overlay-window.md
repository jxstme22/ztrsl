# ADR-005: Ordinary External Tauri Overlay Window

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Captions must appear above a borderless game without interacting with the game process or stealing
input.

## Decision

Use a separate, ordinary top-level Tauri 2 window. Play mode is transparent, topmost,
click-through, and non-activating. Any required Windows-specific style code is isolated, documented,
and limited to the app's own window.

## Consequences

True exclusive fullscreen is unsupported in V1. Focus, Alt+Tab, multi-monitor, mixed-DPI, and
off-screen recovery require Windows manual validation.

## Alternatives Considered

Graphics hooks, injection, official-UI imitation, and game-process access are forbidden.

## Evidence and Review Trigger

Review after Phase 1 focus-invariant and Borderless Windowed evidence.

