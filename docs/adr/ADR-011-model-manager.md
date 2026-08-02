# ADR-011: In-App Model Manager

## Status
Accepted

## Context
The app ships with zero model files; users must download them separately via
a CLI script (`scripts/install_models.py`) that requires knowing the workspace
layout and having Python with ML dependencies preinstalled. This blocks new
users who expect a one-click install.

## Decision
Embed a Rust model-manager crate (`crates/model-manager`) into the desktop
binary. On first run the app shows a blocking welcome dialog listing available
models with pinned source URLs, sizes, and license information. The user picks
which to download; no network activity happens before their explicit choice.
Models are downloaded one artifact at a time with streaming SHA-256
verification, staged in a temporary directory, then atomically renamed into the
store directory (per-user `%LOCALAPPDATA%` in production, workspace `models/`
in development). Deletion is safe: a model in use by a running live session is
protected and refuses deletion.

### Catalog
A single `models/catalog.json` (checked in) carries every downloadable entry
with per-file sha256 checksums and the exact source revision. The catalog is
embedded into the Rust binary via `include_str!` — no network fetch is needed
to learn what is available. Adding a new model means adding a catalog entry
and committing the corresponding `models/manifests/*.json` for dev scripts.

### Consequences
- Users no longer need a Python environment or ML libraries to install models.
- The PyInstaller-packaged sidecar still bundles the inference runtime, but
  the runtime **never** downloads models on its own — only the app UI does.
- The app ships CLI-less: one installer, one welcome flow.
- The catalog is versioned with the app; old app versions cannot accidentally
  fetch newer model revisions.