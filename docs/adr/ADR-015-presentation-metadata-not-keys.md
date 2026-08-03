# ADR-015: Editable Presentation Metadata Never Used as Keys

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

Users must freely rename sources and retag captions (`[TEAM]`, `[DISCORD]`).
Names and tags are the first thing a developer reaches for as a key. Using them
as keys creates cross-source collisions, breaks state on rename, and invites
UI-input injection into pipeline internals.

## Decision

- `display_name` and `caption_tag` are presentation-only. They are validated
  and length-bounded (tag ≤ 16 recommended, hard cap 32; no control chars;
  trimmed; single-line), but they participate in NO pipeline key, queue key,
  IPC session key, persistence key, or revision sequence.
- The only identifier that flows through audio frames, captions, scheduler
  jobs, and storage is `source_id` (ADR-013).
- Caption payloads carry a `source_snapshot` (tag + style + color) so the
  overlay renders from data stamped at send time; the sidecar is told about
  presentation changes via `source.presentation.update` and never mutates
  state keyed by presentation text.
- Tags are treated as untrusted data: escaped on every render path, never
  evaluated as HTML (Phase 8 hardening + tests).

## Consequences

- Rename/tag edits are cheap and non-disruptive.
- Defense-in-depth against malformed or hostile tag input.
- Overlay correctness depends on the snapshot field, not on cached tables.

## Alternatives Considered

- Key by tag with a uniqueness constraint: rejected — still breaks on rename
  and leaks UI text into internals.
- No presentation stamp on captions (overlay looks up by id): rejected —
  id-only lookup makes the overlay stale after edits and complicates the
  sidecar.

## Evidence and Review Trigger

- Phase 1 tests: tag validation + duplicate-tag warnings are UI-level only.
- Phase 2: `source.presentation.update` test proves rename has no effect on
  revisions or audio keys.
- Phase 8: XSS-style tag payloads render inert (escaping tests).
