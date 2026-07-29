#!/usr/bin/env sh
set -eu

pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

uv sync --frozen --extra dev
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest

