import type { Caption, OverlaySettings } from "./model";

export type CaptionState = readonly Caption[];

export type CaptionAction =
  | { type: "upsert"; caption: Caption }
  | { type: "expire"; nowMs: number }
  | { type: "clear" };

export const MAX_CAPTIONS = 2;

/** Lane key: a caption owns its source's lane (immutable id) when it carries
 * a source snapshot, otherwise it is its own lane (legacy/fake captions). */
export function laneKey(caption: Caption): string {
  return caption.source?.sourceId ?? caption.id;
}

export function readingDurationMs(text: string): number {
  return Math.min(7_000, Math.max(2_000, 1_200 + text.length * 65));
}

export function captionReducer(
  state: CaptionState,
  action: CaptionAction,
): CaptionState {
  if (action.type === "clear") {
    return [];
  }

  if (action.type === "expire") {
    return state.filter((caption) => caption.expiresAtMs > action.nowMs);
  }

  const existing = state.find((caption) => caption.id === action.caption.id);
  if (
    existing !== undefined &&
    (existing.status === "final" ||
      action.caption.revision <= existing.revision)
  ) {
    return state;
  }

  // One caption per source lane: a newer caption from the same source
  // replaces the older one instead of competing for the limited slots.
  const key = laneKey(action.caption);
  const others = state.filter((caption) => laneKey(caption) !== key);

  return [...others, action.caption]
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(-MAX_CAPTIONS);
}

/**
 * Choose which captions to render for the overlay given the simultaneous
 * policy and per-source visibility (Phase 8). Hidden sources are filtered
 * first; the policy then selects one or two lanes:
 * - `show-both` — the primary source's lane (or the newest) plus the newest
 *   other lane;
 * - `newest-wins` — only the single newest caption;
 * - `primary-wins` — only the primary source's lane, falling back to the
 *   newest caption when the primary source has nothing.
 */
export function selectVisibleCaptions(
  state: CaptionState,
  settings: Pick<
    OverlaySettings,
    "primarySourceId" | "hiddenSourceIds" | "simultaneousPolicy"
  >,
): Caption[] {
  const visible = state.filter(
    (caption) =>
      caption.source === undefined ||
      !settings.hiddenSourceIds.includes(caption.source.sourceId),
  );
  if (visible.length === 0) {
    return [];
  }

  const newest = (left: Caption, right: Caption) =>
    right.createdAtMs - left.createdAtMs;
  const byNewest = [...visible].sort(newest);
  const newestCaption = byNewest[0];
  if (newestCaption === undefined) {
    return [];
  }
  const primary =
    settings.primarySourceId === null
      ? undefined
      : byNewest.find(
          (caption) => caption.source?.sourceId === settings.primarySourceId,
        );

  if (settings.simultaneousPolicy === "newest-wins") {
    return [newestCaption];
  }

  if (settings.simultaneousPolicy === "primary-wins") {
    return [primary ?? newestCaption];
  }

  const primaryLane = primary ?? newestCaption;
  const secondary = byNewest.find(
    (caption) => laneKey(caption) !== laneKey(primaryLane),
  );
  return secondary === undefined ? [primaryLane] : [primaryLane, secondary];
}
