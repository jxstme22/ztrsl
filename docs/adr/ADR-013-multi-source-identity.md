# ADR-013: Multi-Source Audio with Immutable Source Identity

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

v0.3 introduces multiple simultaneous audio sources (game, Discord, party chat).
Routing, VAD, ASR, translation, scheduling, and the overlay must attribute audio
and captions to the correct source. v0.2 had exactly one implicit source with a
mutable `source_mode` string. Using user-editable names as keys would break
pipeline state on rename and enable collisions.

## Decision

Every source has three distinct fields (spec §2):

- `source_id` — immutable, generated once at creation (UUID v4, lowercase hex,
  32 ASCII chars; 16-byte binary form in the v2 audio header). Never derived
  from name, tag, endpoint, or order. Never reused after deletion.
- `display_name` — editable human-readable label.
- `caption_tag` — editable short tag shown on captions (e.g. `TEAM`, `DISCORD`).

All pipeline state (queues, utterance state, sequences, metrics, scheduler
jobs, IPC frames, persistence keys) is keyed by `source_id` only. Name and tag
are presentation metadata that may change freely while the source is live.

## Consequences

- Renaming/retagging never interrupts capture, VAD, ASR, or captions.
- Persistence keys and IPC keys are stable across user edits.
- Cost: extra 16 bytes per audio frame (v2 header), one extra field in every
  caption payload.

## Alternatives Considered

- Key by `caption_tag`: rejected — tags are user-editable and duplicateable.
- Key by endpoint id: rejected — process sources have no stable endpoint; user
  may retarget a source.
- Key by display name: rejected — free text, collides, mutable.

## Evidence and Review Trigger

- Phase 2 fake-sidecar test: rename DISCORD mid-session → TEAM revisions and
  audio keys unchanged.
- Phase 3: two sources share no state; Phase 8: caption attribution correct
  after renames.
