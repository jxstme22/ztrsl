# Phase 8 — Source-Aware Overlay

**Status:** ☑ complete

## Acceptance criteria (spec §17 Phase 8)

1. Primary + secondary caption lanes render per source; simultaneous policy (show both / newest wins / primary wins) works.
2. All label styles render: brackets `[TEAM]`, colon `TEAM:`, bullet `• TEAM`, stacked, hidden.
3. Per-source caption expiration; per-source visibility (hide source by caption_tag or display_name).
4. Long captions shrink within lane limits (v0.2 caption-fit work reused).
5. Labels are escaped data, never HTML — no XSS via tag content.

## Implementation

### Overlay caption model (`apps/desktop/src/overlay/model.ts`)

`captionSchema` gained an optional `source` snapshot (`captionSourceSchema`):
immutable `sourceId`, `captionTag`, `labelStyle`, `color`. Labels are rendered
from this snapshot — never from a mutable source table — so mid-session renames
are applied by the sidecar's snapshot and the overlay always shows the state the
caption was sent with (ADR-015).

`overlaySettingsSchema` bumped to **schemaVersion 2** with three new fields:
- `simultaneousPolicy`: `show-both` | `newest-wins` | `primary-wins`
- `primarySourceId`: immutable id owning the first lane (null = auto)
- `hiddenSourceIds`: immutable ids whose captions are hidden

`storage.ts` migrates v1 documents to v2 (keeps existing values, fills the new
fields with safe defaults). Settings writes remain content-free.

### Lane logic (`apps/desktop/src/overlay/reducer.ts`)

- The reducer keeps **one caption per source lane** (keyed by immutable
  `sourceId`) instead of evicting across sources by recency, so TEAM and
  DISCORD never fight for the two slots.
- `selectVisibleCaptions(state, settings)` is a pure selector: it filters
  hidden sources, then applies the policy — `show-both` returns the primary
  lane (or newest) plus the newest other lane; `newest-wins` returns only the
  newest caption; `primary-wins` returns the primary lane (falling back to the
  newest when the primary source is silent).
- Per-source expiration is per-caption `expiresAtMs` (unchanged); each lane
  clears independently when its own caption expires.

### Rendering (`apps/desktop/src/components/CaptionStack.tsx`)

`CaptionStack` renders the resolved lanes. Each lane shows the source label via
the existing `renderLabel` (labels.ts) using the caption's own
`source.labelStyle` — all five styles (brackets, colon, bullet, stacked,
hidden) render. Labels and text are React text nodes only: never
`dangerouslySetInnerHTML`, so a tag containing `<script>` or quotes renders as
inert data. Long captions still shrink via `fitScaleForLength` (captionFit
unchanged).

`useLiveTranslation` maps the v2 `source_snapshot` + `source_id` onto the
overlay caption, so live v2 sessions produce labeled lanes automatically.

### Settings UI (`apps/desktop/src/ControlApp.tsx`)

The Settings page gained: simultaneous-policy select, primary-source select
(populated from the source configs), and per-source hide toggles.

## Files

- `apps/desktop/src/overlay/model.ts`, `reducer.ts`, `storage.ts`
- `apps/desktop/src/overlay/reducer.test.ts`, `storage.test.ts`
- `apps/desktop/src/components/CaptionStack.tsx`, `CaptionStack.test.tsx`
- `apps/desktop/src/live/useLiveTranslation.ts`
- `apps/desktop/src/ControlApp.tsx`, `styles.css`
- `apps/desktop/src/sources/migration.test.ts`, `sources/storage.test.ts`

## Evidence

- Reducer: one-caption-per-lane behavior, stale/final/expire semantics.
- `selectVisibleCaptions`: all three policies + primary pinning + fallback,
  hidden-source filtering, empty state.
- `CaptionStack.test.tsx`: sourced label rendering, all five label styles,
  two independent source lanes, hide-source, per-source expiration (renderer
  keeps lanes; expiration is reducer-driven), newest-wins single lane, and the
  XSS escaping test (a `<img onerror>` tag renders inert, no element is
  injected).
- Desktop suite: `156 passed`; `pnpm typecheck` + `pnpm lint` clean.
- Font-fit regression: `captionFit.test.ts` stays green (function unchanged).
