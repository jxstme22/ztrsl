# ADR-007: Ephemeral Content by Default

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Raw voices, source transcripts, and translations are sensitive content belonging to real people.

## Decision

Raw audio, transcripts, translations, and history are memory-only and short-lived by default.
Telemetry and crash upload are off. Diagnostic recording requires explicit, visible, revocable
consent and a clear deletion path.

## Consequences

Debugging relies on content-free metrics unless the user deliberately records diagnostics. Support
bundles exclude content by default.

## Alternatives Considered

Automatic history, automatic recording, opt-out telemetry, and silent crash uploads were rejected.

## Evidence and Review Trigger

Audit logs, support bundles, settings migrations, and crash behavior before every release gate.

