import type { Caption } from "./model";

export type CaptionState = readonly Caption[];

export type CaptionAction =
  | { type: "upsert"; caption: Caption }
  | { type: "expire"; nowMs: number }
  | { type: "clear" };

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

  return [
    ...state.filter((caption) => caption.id !== action.caption.id),
    action.caption,
  ]
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(-2);
}
