import { z } from "zod";

import type { Caption } from "../overlay/model";

/**
 * Captions history: a small, persisted ring buffer of FINAL captions only.
 * Provisional ("listening") captions never enter history — the overlay and
 * the History page show a finished chat transcript, not the live pipeline.
 */
export const CAPTION_HISTORY_LIMIT = 10;

export const historyEntrySchema = z.object({
  /** Caption id; the same id upserts in place (final replaces provisional). */
  id: z.string().min(1).max(128),
  /** Final translated text; falls back to the source text when empty. */
  text: z.string().min(1).max(500),
  /** Source display label ("SRC" tag) when the caption carried one. */
  sourceLabel: z.string().max(32),
  /** Immutable source id (32-hex) when the caption came from a v2 source. */
  sourceId: z.string().default(""),
  /** Who's talking: the source display name (falls back to the source tag). */
  displayName: z.string().max(48),
  /** Per-source accent color (#rrggbb) when the source defines one. */
  color: z.string().default(""),
  /** Which audio input produced this caption (mic / loopback / system). */
  audioSource: z.string().max(64),
  /** Wall-clock finalization time (ms). */
  timestampMs: z.number().nonnegative(),
  /** True when the sidecar flagged the final as low-confidence. */
  uncertain: z.boolean(),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

const HISTORY_STORAGE_KEY = "lst.captions.history.v1";

export const historyStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(historyEntrySchema).max(CAPTION_HISTORY_LIMIT),
});

export type HistoryState = z.infer<typeof historyStateSchema>;

export type HistoryAction =
  | { type: "record"; caption: Caption; context?: HistoryContext }
  | { type: "clear" };

/** Session context stamped onto a recorded entry at finalization time. */
export type HistoryContext = {
  /** Who's talking: resolved source display name. */
  displayName?: string;
  /** Which audio input the session captures (mic / loopback / system). */
  audioSource?: string;
};

const DEDUPE_WINDOW_MS = 6_000;

export function emptyHistoryState(): HistoryState {
  return { version: 1, entries: [] };
}

/** Entries the overlay panel shows, capped by the user's row preference.
 * "auto" keeps everything the buffer holds; fixed counts keep the newest N
 * lines so the chat never overflows the panel. */
export function visibleHistoryEntries(
  entries: readonly HistoryEntry[],
  maxRows: "auto" | 5 | 10,
): HistoryEntry[] {
  return maxRows === "auto" ? [...entries] : entries.slice(-maxRows);
}

function entryForCaption(
  caption: Caption,
  context: HistoryContext,
): HistoryEntry {
  const text = caption.englishText.trim() || caption.sourceText.trim();
  return {
    id: caption.id,
    text,
    sourceLabel: caption.source?.captionTag ?? "",
    sourceId: caption.source?.sourceId ?? "",
    displayName: context.displayName ?? "",
    color: caption.source?.color ?? "",
    audioSource: context.audioSource ?? "",
    timestampMs: Date.now(),
    uncertain: caption.certainty?.state === "uncertain",
  };
}

/** Pure reducer: finals only, in-place upsert, consecutive-dup merge, capped.
 * Entries stay in chat order — oldest first, newest appended last — so the
 * transcript reads top-to-bottom like a chat log. */
export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "clear":
      return emptyHistoryState();
    case "record": {
      const { caption, context = {} } = action;
      if (caption.status !== "final") {
        return state;
      }
      const entry = entryForCaption(caption, context);
      if (entry.text === "") {
        return state;
      }
      const entries = state.entries.slice();
      const existing = entries.findIndex(
        (candidate) => candidate.id === entry.id,
      );
      if (existing !== -1) {
        entries[existing] = entry;
        return { ...state, entries };
      }
      // A repeated final (VAD overlap re-finalizing the same sentence) just
      // refreshes the timestamp instead of duplicating the line.
      const newest = entries[entries.length - 1];
      if (
        newest?.text === entry.text &&
        entry.timestampMs - newest.timestampMs < DEDUPE_WINDOW_MS
      ) {
        return {
          ...state,
          entries: [
            ...entries.slice(0, -1),
            { ...newest, timestampMs: entry.timestampMs },
          ],
        };
      }
      entries.push(entry);
      return {
        version: 1,
        entries: entries.slice(-CAPTION_HISTORY_LIMIT),
      };
    }
  }
}

export function loadHistoryState(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): HistoryState {
  const serialized = storage.getItem(HISTORY_STORAGE_KEY);
  if (serialized === null) {
    return emptyHistoryState();
  }
  try {
    const parsed = historyStateSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : emptyHistoryState();
  } catch {
    return emptyHistoryState();
  }
}

export function saveHistoryState(
  state: HistoryState,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state));
}

export function clearHistoryState(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(HISTORY_STORAGE_KEY);
}
