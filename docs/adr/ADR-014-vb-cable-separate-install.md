# ADR-014: Separately Installed VB-CABLE with Detection-Based Routing

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

The spec requires game audio (a game that never outputs to the default device
in a capturable way) to be routed into a capturable endpoint. VB-CABLE is the
designated mechanism. Bundling or auto-installing third-party audio drivers is
a driver-install action with licensing and trust implications that the app must
not perform silently.

## Decision

- xTRSNLTR NEVER bundles, downloads, or silently installs VB-CABLE (or any
  driver). Installation is always a separate, explicit user action.
- The app detects the VB-CABLE endpoints (`CABLE Input`, `CABLE Output`) via
  ordinary WASAPI enumeration and reports honestly: installed / not installed /
  disabled.
- Recommended mode assumes VB-CABLE; advanced mode allows manual endpoint
  selection without it (device loopback only, game must cooperate).
- The Phase 4 wizard explains, step by step, where to get VB-CABLE and what the
  user must do, and runs isolation + monitoring tests to verify the routing.

## Consequences

- No driver-bundling trust or signature risk.
- Users without VB-CABLE get clear guidance instead of a silent failure.
- Detection can never prove "the cable" — only the endpoints — so wizard tests
  verify actual audio flow.

## Alternatives Considered

- Bundle VB-CABLE installer: rejected — silent driver installation crosses the
  safety/trust boundary and complicates licensing.
- PipeWire/loopback via WASAPI only: still viable as advanced mode, but cannot
  capture game audio that bypasses the default device.

## Evidence and Review Trigger

- Phase 4: wizard on a machine without VB-CABLE gives correct guidance; with it,
  recommended-mode routing passes the isolation test.
- Release criteria: "fresh Windows install completes setup with separately
  installed VB-CABLE".
