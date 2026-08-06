# Evaluation fixtures

Stable format for evaluating recognition quality without committing private
user recordings.

## Layout

```text
services/inference/evaluation/fixtures/
├── README.md              ← this file
├── manifest.example.json  ← schema example
└── private/               ← YOUR audio clips go here (git-ignored)
```

## Manifest schema

See `manifest.example.json`. Key rules:

- `schema_version: 1` is required.
- Every clip has a unique `id`, an `audio_path` **relative to this
  directory** (usually under `private/`), a `reference_text`, a
  `primary_language`, and a `private` flag.
- `secondary_languages`, `domain`, `source_origin`, and `conditions` are
  optional metadata used for grouped reporting.
- Clips with `private: true` must live under `private/` so they are never
  committed.

## Metrics supported later

Chinese character error rate · word error rate · empty transcript rate ·
hallucination rate · beginning-clipped rate · ending-clipped rate ·
final latency · language mismatch rate.

## Adding clips

1. Put the audio file under `private/` (or reference an existing asset).
2. Add a clip entry to a manifest (create your own manifest file, do not
   edit `manifest.example.json`).
3. Never commit files under `private/`.
