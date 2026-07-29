# ADR-008: macOS-First Phase 1 Implementation with Deferred Windows Acceptance

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainer

## Context

The build plan requires each phase's automated and manual acceptance checks before the next phase
begins. The current development host is macOS, while the product target and the focus,
click-through, mixed-DPI, and borderless-window acceptance checks require Windows 11. The project
owner explicitly requested continued implementation on macOS and will perform Windows validation
later.

## Decision

Implement Phase 1 on macOS using cross-platform Tauri APIs and pure, tested overlay state logic.
Defer Windows-only manual acceptance without treating it as passed. Phase 1 remains
**implemented but not accepted** until the Windows checklist has evidence. No Windows-specific
window-style workaround will be added without observing a failure on Windows.

## Consequences

Development can continue without inventing Windows results. The overlay may need an isolated
Windows adjustment after focus and click-through testing. Phase 2 audio work remains separately
gated because it depends on ordinary Windows audio endpoints and cannot be validated on macOS.

## Alternatives Considered

Stopping all work until Windows access was available would preserve strict sequencing but was
rejected by the project owner. Claiming macOS behavior as Windows evidence was rejected.

## Evidence and Review Trigger

Review after the overlay is tested over Notepad and a borderless test window on the target Windows
11 PC, including focus, click-through, edit mode, hotkeys, monitor recovery, and mixed DPI.

