# ADR-004: Separately Installed, Verified Model Artifacts

- Status: Accepted
- Date: 2026-07-30
- Owners: Project maintainers

## Context

Model binaries are large, license-sensitive, and part of the software supply chain.

## Decision

Models are installed separately from the application. Every artifact requires an approved source,
license record, exact size, SHA-256 checksum, safe format, atomic install, and rollback. Normal
inference is local-files-only and never enables remote model code.

## Consequences

First-run setup needs a model manager and offline import. Placeholder checksums are never accepted.
No model is downloaded during Phase 0 or CI.

## Alternatives Considered

A monolithic installer and runtime downloads from model code were rejected.

## Evidence and Review Trigger

Review when Phase 6 pins the first ASR artifact and Phase 12 validates repair/removal.

