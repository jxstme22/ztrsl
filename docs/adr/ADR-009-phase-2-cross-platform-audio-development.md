# ADR-009: Cross-Platform Phase 2 Development with Windows Hardware Acceptance Deferred

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainer

## Context

Phase 2 requires Windows endpoint enumeration, device notifications, stable endpoint selection,
and a live capture meter. The current development host is macOS. The owner explicitly requested
the next build now and will perform Windows-specific work and validation later. ADR-008 already
establishes that macOS implementation cannot be treated as Windows acceptance.

## Decision

Build the platform-independent audio contracts, bounded queue, lock-free meter handoff,
deterministic synthetic source, runtime-validated UI, and local endpoint-ID persistence on macOS.
Place Windows Core Audio endpoint enumeration, native-format discovery, default-role discovery,
endpoint peak metering, and bounded `IMMNotificationClient` handling behind Windows compile gates.

Use the Windows endpoint meter interface for the Phase 2 level display. Do not add monitoring,
playback, raw-audio persistence, game-process targeting, or automatic endpoint selection.

Phase 2 remains **implemented but not accepted** until the Windows 11 hardware checklist in
`docs/PHASE_2_VALIDATION.md` is completed. Phase 3 monitoring must not start before that evidence
exists unless another explicit, documented owner deviation is made.

## Consequences

The control flow, schemas, queue bounds, UI, and synthetic diagnostics can be exercised on macOS.
Windows-only Rust is compile-checked from macOS and in Windows CI, but real endpoint names, virtual
cable level behavior, removal/replug recovery, and resource usage remain unknown.

Device notification callbacks use a bounded channel and non-blocking `try_send`; any notification
causes authoritative re-enumeration. A full notification channel may drop an event because the
next retained event still triggers a full catalog refresh.

## Alternatives Considered

Silently selecting a likely virtual cable was rejected because the audio routing specification
requires explicit user choice. Adding cross-platform microphone capture was rejected because it
would not validate the target Windows routing path and would broaden privacy exposure. Starting
Phase 3 playback was rejected because Phase 2 Windows acceptance is still open.

## Evidence and Review Trigger

Review on the target Windows 11 PC after running endpoint enumeration, selected virtual-cable
metering, disconnect/replug, default-device changes, and shutdown checks. Record CPU, RAM, GPU,
VRAM, event recovery timing, and screenshots before marking Phase 2 accepted.
