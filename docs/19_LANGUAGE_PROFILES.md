# 19 — Language Profiles and Strictness

Each source expects a language or a mix. A **language profile** encodes that
expectation; **strictness** controls how hard the expectation is enforced.

## Profiles

| Profile | What it accepts | English terms |
|---------|-----------------|---------------|
| `tagalog` | Tagalog | flagged as mismatch |
| `taglish` | Tagalog + English terms | allowed |
| `cebuano` | Cebuano/Bisaya | flagged as mismatch |
| `bislish` | Cebuano + English terms | allowed |
| `mandarin` | Mandarin | flagged as mismatch |
| `chinese_english` | Mandarin + English | allowed |
| `auto` | Anything | allowed |

## Strictness

- **Off** — accept everything and translate it.
- **Balanced** (default) — filter clear mismatches and junk transcripts.
- **Strict** — suppress anything that is not the profile's language.

## What always passes

- **Tactical callouts** — numbers, `rush`, `rotate`, `site`, `defuse`, and
  the rest of the built-in VALORANT callout glossary pass even under Strict,
  so a "rush B" is never dropped.
- **Short callouts** — very short utterances are protected from
  over-aggressive confidence filtering.

## Capability honesty

Not every speech-recognition model can be hard-locked to one language:

- **Fixed-language decoders** (CTC models) can be forced to one language.
- **Multilingual decoders** are biased but not locked; the language gate
  filters mismatches *after* recognition.

The Models panel labels each model honestly — it never claims a decoder lock
for a model that cannot enforce one.
