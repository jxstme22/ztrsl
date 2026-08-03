# Phase 1 — Source Configuration, Editable Names/Tags, Migration

**Status:** ☑ complete (live-stream preview wiring deferred to Phase 8)

## Acceptance criteria (spec §17 Phase 1)

1. Existing v0.2 installations open with one migrated source that renders `[TEAM] Example caption` in the editor preview.
2. Changing a source's `display_name` or `caption_tag` does not change its internal ID, and no other pipeline state changes.
3. Migration is idempotent; v0.2 settings are preserved as the migrated source's baseline.

## Tasks

### Domain model
- [x] `sources/model.ts`: zod schemas — `CaptionLabelStyle`, `CaptionLane`, `CaptureTarget`, `MonitoringConfig`, `AudioSourceConfig` (schema v3), `SourceConfigs`
- [x] `sources/identity.ts`: immutable `source_id` generation (crypto-random, format + length fixed)
- [x] `sources/presets.ts`: VALORANT Team, Discord, Party Chat, Browser Voice, Custom
- [x] `sources/labels.ts`: pure renderer for brackets/colon/bullet/stacked/hidden styles
- [x] `sources/validation.ts`: tag/name rules, duplicate-tag warning, capture/monitor loop sanity checks
- [x] `sources/migration.ts`: v0.2 → v3 (one source, baseline from legacy settings, idempotent)
- [x] `sources/storage.ts`: schema v3 persistence (separate key from overlay settings)

### Tests
- [x] label renderer (all 5 styles + empty/control-char cases)
- [x] validation (tag rules, duplicates, monitoring loop checks)
- [x] migration (idempotency, baseline preservation, garbage input)
- [x] identity (format, length, uniqueness, immutability by construction)
- [x] storage (round-trip, corrupt payload fallback)
- [x] panel UI tests (migration preview, rename keeps id, add preset, min-1 source, duplicate warning)

### UI
- [x] Sources tab (feature-flagged): list + editor (name, tag, label style, color) + caption preview card
- [x] Preview reuses `.caption-entry` styles so it matches the overlay look
- [ ] Wire live caption stream into preview (deferred to Phase 8; static preview for now)

## Build log

| Date | Action | Evidence |
|---|---|---|
| 2026-08-03 | Created `sources/` domain layer (model, identity, presets, labels, validation, migration, storage, featureFlag) | `pnpm vitest run src/sources` → 52 passed |
| 2026-08-03 | Added SourcesPanel + Sources tab in ControlApp, gated on `multiSourceEnabled()` | `SourcesPanel.test.tsx` → 5 passed |
| 2026-08-03 | Full frontend checks | `pnpm test` 100 passed (19 files), typecheck clean, lint 0 warnings, prettier clean, `pnpm build` ok |
| 2026-08-03 | Full Rust checks (flag work) | workspace `cargo test` 47 passed, clippy 0 warnings, fmt clean |

## Files changed
- `apps/desktop/src/sources/{model,identity,presets,labels,validation,migration,storage,featureFlag}.ts` (new)
- `apps/desktop/src/sources/*.test.ts` (new, 6 files)
- `apps/desktop/src/components/SourcesPanel.tsx` + `SourcesPanel.test.tsx` (new)
- `apps/desktop/src/ControlApp.tsx` (nav entry, feature-flagged)
- `apps/desktop/src/styles.css` (form-grid, source-preview, inline label, warnings, danger button, `--warn`)

## Risks
- Migration fixtures cover realistic v0.2 overlay payloads; live-stream preview is the only deferred item (Phase 8 wires it).

