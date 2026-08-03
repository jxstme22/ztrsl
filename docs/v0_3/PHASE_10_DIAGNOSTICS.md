# Phase 10 — Diagnostics

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 10)

1. Per-source health and metrics (capture, VAD, queue, transcript, filter) are visible.
2. Scheduler and language-filter metrics are visible.
3. Leakage test and content-free support data export exist.
4. Common failure modes are diagnosable without logs.

## Tasks
- [ ] Per-source diagnostic card (phase 3/5/6 metrics)
- [ ] Scheduler metrics (queue depth, drops, coalescing rate, latency)
- [ ] Language-filter metrics (suppressed/flagged/translated counts per source)
- [ ] Leakage test integration (Phase 4)
- [ ] Content-free support bundle export (metrics + config, no transcripts)
- [ ] Diagnostics tab revamp to multi-source

## Files (expected)
- `apps/desktop/src/components/DiagnosticsPanel.tsx` v2
- sidecar metrics endpoints
- `crates/ipc-protocol` diagnostics messages

## Evidence policy
Each diagnostic widget tested with fake data; support bundle export test asserts no transcript content leaks into the archive.
