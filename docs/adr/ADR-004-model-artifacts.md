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

Offline clip ASR uses the pinned MIT-licensed CTranslate2 conversion of OpenAI Whisper
large-v3-turbo. The earlier Apache-2.0 Omnilingual CTC 300M artifact remains a research baseline,
not the default quality provider. This change is evidence-driven: the unconditioned CTC model
script-hopped on a noisy, consented Tagalog DVR clip, while forced-Filipino Whisper preserved
full-clip context and Latin-script source text.

## Consequences

First-run setup needs a model manager and offline import. Placeholder checksums are never accepted.
No model is downloaded during Phase 0 or CI.

## Alternatives Considered

A monolithic installer and runtime downloads from model code were rejected.

## Evidence and Review Trigger

Review when the Windows RTX benchmark compares Whisper with language-conditioned Omnilingual
LLM-ASR, and again when Phase 12 validates repair/removal.
