# ADR-010: Owner-Authorized Phase 3 and 4 Development Before Windows Acceptance

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainer

## Context

The build plan normally prevents Phase 3 from starting before Phase 2 Windows hardware acceptance
and Phase 4 from starting before Phase 3 acceptance. The development host remains macOS. The
project owner explicitly requested completion of the Phase 2 buildable work and immediate Phase 3
and Phase 4 development before moving the repository to the target Windows 11 PC.

## Decision

Proceed with platform-neutral, deterministic Phase 3 routing and Phase 4 local-IPC vertical slices.
Do not treat this sequencing exception as acceptance of Windows endpoint capture, monitoring
playback, focus behavior, device recovery, or soak tests.

Phase 3 uses a synthetic source and monitor on macOS while preserving the production interfaces,
queue bounds, resampling behavior, feedback checks, and diagnostics required by the future Windows
backend. Phase 4 uses a real loopback-only WebSocket transport and a supervised Python fake
inference process because those behaviors can be validated on macOS without models or game access.

## Consequences

Phase 4 protocol and lifecycle work can progress while the Windows WASAPI capture/playback backend
remains incomplete. The Windows PC handoff must return to the Phase 1, 2, and 3 acceptance records
before starting model-backed VAD or inference work.

No implementation or documentation may describe synthetic monitoring as audible Windows
monitoring. No Phase 3 hardware acceptance item is checked on the basis of macOS tests.

## Alternatives Considered

Stopping after Phase 2 until the Windows machine was available was consistent with the default
build plan but was explicitly overridden by the owner. Implementing macOS microphone capture was
rejected because it would broaden voice access without validating the target Windows virtual-cable
topology.

## Evidence and Review Trigger

Review when the repository is moved to Windows 11. Complete the Phase 1 overlay checklist, Phase 2
endpoint checklist, and Phase 3 routing/headset/soak checklist before Phase 5.
