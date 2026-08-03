# IPC v2 — Frozen Wire Contract (v0.3.0)

Status: FROZEN for implementation (Phase 0). Changes require a new ADR + freeze revision.

Applies to the local WebSocket control channel and the audio stream between the
Tauri desktop app and the Python sidecar, and to the TS decode layer
(`apps/desktop/src/ipc/model.ts`). Both Rust and Python keep a v1 path; the
handshake in §1 selects the active version per session.

Compatibility target: the v1 wire format is unchanged (bytes and JSON both).
v1 sessions behave exactly like v0.2 (single legacy source).

## 1. Negotiation (unchanged shape, new capability)

`HelloPayload` gains a capability string:

```jsonc
{
  "protocol_versions": [1, 2],
  "capabilities": ["ipc_v2", "multi_source"]
}
```

- Desktop proposes `[2, 1]` when the `multi_source_audio` flag is enabled, else `[1]`.
- Sidecar accepts the highest common version. `HelloAcceptedPayload.protocol_version`
  is the negotiated version for the session.
- `ipc_v2` implies: v2 audio header (§2), v2 captions (§3), and the
  `source.presentation.update` control (§4).

## 2. Audio header v2 (66 bytes)

v1 header is 50 bytes: `<4sHH16sQQIHI` — magic, version, flags, session_id(16),
sequence, capture_monotonic_ns, sample_rate, channels, sample_count.

v2 appends `source_id` (16 bytes) at offset 50. New binary layout:

```
<4sHH16sQQIHI16s   (66 bytes)
```

- `source_id`: the 16-byte lowercase hex encoding of the source's UUID
  (32 ASCII bytes in the ASCII payload form — see §4 field rules), NUL-padded
  to the 16-byte slot only if the wire representation is binary; in the ASCII
  form the full 32-char id is placed at the same offset.
  Decision: **binary slot is 16 bytes; the sidecar receives the 32-char ASCII
  form in the control channel**, so the slot is the raw bytes of the UUID and
  the length is not inferred from padding.
- `version` field carries `2`.
- All other fields are identical to v1 and mean the same thing.

Every audio frame in a v2 session MUST carry a valid `source_id`. There is no
wildcard/default source.

## 3. Caption payload v2 (JSON)

`CaptionPayload` is extended (v1 fields unchanged):

```jsonc
{
  "caption_id": "…", "utterance_id": "…", "revision": 3,
  "status": "provisional",
  "source_id": "6f2b…",
  "source_snapshot": {
    "display_name": "Valorant Team",
    "caption_tag": "TEAM",
    "label_style": "brackets",
    "color": "#7dd3fc"
  },
  "source_text": "…", "english_text": "…",
  "strictness": "balanced",
  "filter_applied": "off",          // off | suppressed | flagged | passed
  "filter_reason": null,            // profile/mismatch code when filtered
  "started_monotonic_ns": 0, "ended_monotonic_ns": 0,
  "capture_to_caption_ms": 0, "asr_ms": 0, "translation_ms": 0,
  "confidence": 0.9,
  "warnings": []
}
```

Rules:
- `source_id` is the immutable identity. Presentation fields NEVER change the
  caption's identity or revision sequence.
- `source_snapshot` is the presentation state at send time; consumers render
  from the snapshot, not from any cached source table.
- `strictness` ∈ `off | balanced | strict`; `filter_applied` ∈
  `off | suppressed | flagged | passed`; when `suppressed`, the sidecar still
  sends the payload with `suppressed` (the overlay may hide it) and MUST also
  emit the filter metric (Phase 10).
- `label_style` ∈ `brackets | colon | bullet | stacked | hidden`;
  `color` is a `#RRGGBB` or `#RRGGBBAA` hex string, or null (app default).
- TS mirror schema in `apps/desktop/src/ipc/model.ts` must validate with zod
  and reject unknown label styles.

## 4. Control messages (v2-only)

### `source.presentation.update` (desktop → sidecar)

```jsonc
{
  "type": "source.presentation.update",
  "payload": {
    "source_id": "6f2b…",
    "source_snapshot": { "display_name": "…", "caption_tag": "…", "label_style": "brackets", "color": "#7dd3fc" }
  }
}
```

- The sidecar only updates the snapshot it stamps onto future captions.
- It MUST NOT touch audio routing, VAD state, utterance state, queues, or any
  key. Errors: `unknown_source` if `source_id` is not in the session's registry.

### `source.registry` (desktop → sidecar at start, and on registry change)

```jsonc
{
  "type": "source.registry",
  "payload": { "sources": [
    { "source_id": "6f2b…", "display_name": "Valorant Team", "caption_tag": "TEAM",
      "capture_target": { "kind": "endpoint", "endpoint_id": "…" },
      "language_profile": "tagalog", "strictness": "balanced", "label_style": "brackets", "color": "#7dd3fc" }
  ]}
}
```

- `capture_target.kind` ∈ `endpoint | process` (process: `process_name`).
- The sidecar uses this to set per-source language/strictness behavior before
  the first frame; presentation changes after start arrive as
  `source.presentation.update`.

## 5. v1 ↔ v2 mapping rules

- v1 session: audio header stays 50 bytes; captions use the legacy single-source
  payload; `source_id` is synthesized client-side from the session (fixed,
  private, never surfaced).
- A v2 session MUST NOT receive v1 frames; the sidecar rejects a v1-shaped frame
  in a v2 session with a control error `protocol_mismatch`.

## 6. Freeze test requirements

- Rust `ipc-protocol`: v2 header encode/decode round-trip; caption payload
  round-trip incl. unknown-label-style rejection; `validate_version` against 2.
- Python `protocol.py`: same round-trips; negotiation pick test ([2,1] vs [1,2]).
- TS: v2 caption decode; strict zod validation.
- Fake sidecar: TEAM + DISCORD sources → independent caption streams; rename
  DISCORD mid-session → no effect on TEAM revisions or any audio key.
