import type { CaptionLabelStyle } from "./model";

/**
 * Pure label rendering for caption tags (spec §3.3). The overlay renders the
 * returned text as plain data — never as HTML (ADR-015; Phase 8 escaping).
 */

export type RenderedLabel = {
  /** Text for the label span, or `null` when the style hides the tag. */
  label: string | null;
  /** When true the label renders on its own line above the caption text. */
  stacked: boolean;
};

/**
 * Render a caption tag for the given style. An empty or whitespace-only tag
 * always yields `null` (never empty brackets like `[]`).
 */
export function renderLabel(
  tag: string,
  style: CaptionLabelStyle,
): RenderedLabel {
  const clean = tag.trim();
  if (clean.length === 0) {
    return { label: null, stacked: false };
  }
  switch (style) {
    case "hidden":
      return { label: null, stacked: false };
    case "colon":
      return { label: `${clean}:`, stacked: false };
    case "bullet":
      return { label: `\u2022 ${clean}`, stacked: false };
    case "stacked":
      return { label: clean, stacked: true };
    case "brackets":
    default:
      return { label: `[${clean}]`, stacked: false };
  }
}

/**
 * Full preview line combining label and caption text the way the overlay
 * composes it (used by the source editor preview and overlay tests).
 */
export function formatPreview(
  tag: string,
  style: CaptionLabelStyle,
  text: string,
): string {
  const { label, stacked } = renderLabel(tag, style);
  if (label === null) {
    return text;
  }
  return stacked ? `${label}\n${text}` : `${label} ${text}`;
}
