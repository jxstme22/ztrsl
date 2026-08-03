# Phase 10 — Diagnostics

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 10)

1. Per-source health and metrics (capture, VAD, queue, transcript, filter) are visible.
2. Scheduler and language-filter metrics are visible.
3. Leakage test and content-free support data export exist.
4. Common failure modes are diagnosable without logs.

## Implementation

### Diagnostics model (`apps/desktop/src/diagnostics/model.ts`)

`DiagnosticsSnapshot` is the content-free shape the panel renders:
- `sources: SourceDiagnostics[]` — per-source VAD metrics (`packetsReceived`,
  `utterancesCompleted`, `captionsEmitted`, `utterancesDropped`,
  `lowConfidenceCaptions`, open-utterance size) plus the Phase 7
  language-filter counters (`filter.applied/suppressed/flagged/passed/off`).
- `scheduler: SchedulerMetrics` — queue depth, oldest/avg/max queue delay,
  finals/provisionals completed, coalescing rate, drops, overload events.
- `leakage: LeakageReport` — isolation-check outcome.

Transcripts are never part of any payload; the schemas carry counts only.

### Content-free support bundle (`apps/desktop/src/diagnostics/supportBundle.ts`)

`buildSupportBundle` assembles a JSON document of metrics + config only:
app version, diagnostics snapshot, per-source config (ids, names, tags,
profiles, strictness — no audio/targets), and overlay placement settings.
`serializeContentFree` refuses to emit the archive if any transcript key
(`english_text`, `source_text`, `transcript`, samples, …) is present — a leak
can never be exported silently.

### Isolation/leakage check (`apps/desktop/src/diagnostics/leakage.ts`)

`classifyLeakage` inspects a multi-source caption roundtrip using **only**
source identity fields: it fails on any caption with a missing `source_id`,
fewer than two distinct sources, or a mismatched snapshot tag. The desktop
runs it against the multi-source fake roundtrip (`useDiagnostics.runLeakage`);
a browser-mode run reports the requirement honestly instead of faking a pass.

### Diagnostics panel (`apps/desktop/src/components/DiagnosticsPanel.tsx`)

Renders scheduler metrics (queue depth, delay, coalescing, overload),
per-source cards with VAD + filter metrics, the isolation-check result (with a
re-run action), and the support-bundle export button. The Diagnostics tab in
`ControlApp` now leads with the panel and keeps the device/routing/ipc widgets
below it.

## Files

- `apps/desktop/src/diagnostics/{model,supportBundle,leakage,useDiagnostics}.ts`
- `apps/desktop/src/diagnostics/{supportBundle,leakage}.test.ts`
- `apps/desktop/src/components/DiagnosticsPanel.tsx` (+ test)
- `apps/desktop/src/ControlApp.tsx`, `styles.css`

## Evidence

- `supportBundle.test.ts`: bundle includes metrics + config only; serialization
  never leaks transcript keys; missing source-configs handled; a corrupted
  diagnostics payload containing `source_text` is refused at export.
- `leakage.test.ts`: two isolated sources pass; missing `source_id`, a single
  distinct source, and empty rounds all fail with a diagnostic detail.
- `DiagnosticsPanel.test.tsx`: scheduler, per-source, filter, isolation, empty
  state, and content-free export rendered from fake data.
- Desktop suite: `168 passed`; `pnpm typecheck` + `pnpm lint` clean.

## Follow-ups

- Wire a real live-session diagnostics command (sidecar `source.diagnostics` +
  `scheduler.metrics` polling) into `useDiagnostics.applyDiagnostics` in the
  Tauri runtime; the schemas and panel already accept it.
