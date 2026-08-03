# ADR-016: Per-Source Language Profiles and Strictness

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

Different sources speak different languages or mixes (game voice: Tagalog/Taglish;
Discord: Cebuano/Bislish; international party: Mandarin; sometimes English-only).
A single global language assumption makes captions useless or noisy per source.
Users also need control over how strictly the language expectation is enforced —
and the UI must never overstate what the provider can do.

## Decision

- Each source selects a language profile: `tagalog`, `taglish`, `cebuano`,
  `bislish`, `mandarin`, `chinese_english`, or `auto` (per spec §6.2).
- Each source selects strictness: `Off` (accept everything, translate anyway),
  `Balanced` (default; filter only confident mismatches), `Strict`
  (suppress/flag mismatches aggressively).
- Capability honesty: a provider either supports the profile **forced**
  (decoder constrained to the language), **preferred** (biased without hard
  constraint), or **post-filter** (decode normally, then filter by confidence).
  The UI renders the actual capability; it never claims decoder locking for
  post-filter-only providers (spec §6.4).
- Strictness is applied per utterance at the language gate: output is
  `off | suppressed | flagged | passed`, stamped onto the caption payload, and
  counted in filter metrics (Phase 10). `suppressed` captions are still sent
  and hidden client-side.
- Tactical bypass: a per-source glossary of allowed expressions (numbers,
  callouts, positions) passes the gate; English-skip lets English sources skip
  translation. Both are per source.

## Consequences

- Correct behavior per source instead of one global mode.
- Slightly more UI surface (profile + strictness per source).
- Post-filter providers may leak speech in the strictest mode — the UI says so.

## Alternatives Considered

- Global strictness only: rejected — defeats the multi-source purpose.
- Hard decoder locking everywhere: rejected — unavailable for several
  providers (e.g. faster-whisper multilingual decoders).

## Evidence and Review Trigger

- Phase 7 matrix: profile × provider × strictness expected-vs-actual behavior.
- UI capability-honesty test: no "locked to X" text for post-filter providers.
- Release criteria: "strictness demonstrably changes behavior; UI never claims
  decoder locking for post-filter-only providers".
