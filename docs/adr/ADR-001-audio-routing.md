# ADR-001: Signed Virtual Audio Cable for V1

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Incoming voice chat must be isolated without hooks, game memory access, packet interception, or a
custom driver. Standard render-endpoint loopback would normally include the full endpoint mix.

## Decision

V1 uses a signed third-party virtual audio cable installed separately by the user. VALORANT voice
output is routed to the cable, while game audio remains on physical headphones. The app captures
the cable and monitors it to the selected headphones through ordinary Windows audio APIs.

## Consequences

Setup is more involved and monitoring latency must be measured. The app will not silently install
or redistribute a driver. Feedback prevention and device-recovery UX are mandatory.

## Alternatives Considered

Application loopback remains a research branch only. Shipping a custom driver and any form of
game-process integration are rejected.

## Evidence and Review Trigger

Review after Phase 3 routing, feedback, device-churn, and two-hour soak evidence is available.

