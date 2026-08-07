# Privacy

Local-first: audio is processed on your machine. No cloud audio unless you
explicitly select a cloud provider (Groq, NVIDIA NIM) — recognized text is
then sent to that provider only while it is selected.

- Raw audio is never persisted unless you enable diagnostic recording.
- Captions history stays local (bounded, cleared manually).
- No telemetry without explicit opt-in.
- Model downloads are pinned and checksum-verified; no game-process
  access, memory reads, or automation (see the repo's safety boundary).
