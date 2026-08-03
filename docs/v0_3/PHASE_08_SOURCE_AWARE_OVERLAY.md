# Phase 8 — Source-Aware Overlay

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 8)

1. Primary + secondary caption lanes render per source; simultaneous policy (show both / newest wins / primary wins) works.
2. All label styles render: brackets `[TEAM]`, colon `TEAM:`, bullet `• TEAM`, stacked, hidden.
3. Per-source caption expiration; per-source visibility (hide source by caption_tag or display_name).
4. Long captions shrink within lane limits (v0.2 caption-fit work reused).
5. Labels are escaped data, never HTML — no XSS via tag content.

## Tasks
- [ ] Overlay caption payload carries source presentation snapshot (IPC v2 field)
- [ ] Two-lane rendering (`.caption-entry` reuse) + simultaneous policies
- [ ] Label style renderer wired to overlay (Phase 1 `labels.ts` reused)
- [ ] Per-source expiration + hide-source
- [ ] Escaping test: tag with `<script>`, quotes, RTL text renders inert
- [ ] E2E: `[TEAM] Rotate B!` + `[DISCORD] Let's go!` independent (fake sidecar)
- [ ] Font-fit regression: long captions still shrink (captionFit tests stay green)

## Files (expected)
- `apps/desktop/src/overlay/model.ts` (v2 caption schema with source snapshot)
- `apps/desktop/src/components/CaptionStack.tsx` (lanes)
- `apps/desktop/src/styles.css` (lane styles, safe label rendering)

## Evidence policy
Frontend tests for all policies/styles/escaping + fake-sidecar E2E screenshot of the two-source overlay.
