import { z } from "zod";

import type { Caption } from "../overlay/model";

/**
 * Captions history: persisted FINAL captions grouped into sessions.
 * Provisional ("listening") captions never enter history — the overlay and
 * the History page show a finished chat transcript, not the live pipeline.
 *
 * A session is created when live translation starts (see useLiveTranslation)
 * and ends explicitly from the stop-live confirmation modal, so a stopped
 * session can be "kept open" and reused by the next start.
 */
/** Hard safety net so a runaway session cannot exhaust localStorage (~5MB). */
export const SESSION_MAX_ENTRIES = 2000;

/** The fixed source id of the user's own microphone stream ("you" bubbles).
 * Immutable 32 lowercase hex, never collides with user-configured sources. */
export const YOU_SOURCE_ID = "00000000000000000000000000000000";

/** CTA accent used for "you" bubbles (matches the send-button accent). */
export const YOU_ACCENT_COLOR = "#dc4d5e";

export const historyEntrySchema = z.object({
  /** Caption id; the same id upserts in place (final replaces provisional). */
  id: z.string().min(1).max(128),
  /** Final translated text; falls back to the source text when empty. */
  text: z.string().min(1).max(500),
  /** Transcribed (source-language) input, when the caption carried one. */
  sourceText: z.string().max(500).default(""),
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
  /** Wall-clock first-sighting time (ms); defaults to the final time. */
  startedAtMs: z.number().nonnegative().default(0),
  /** Caption status at record time ("final" only ever enters). */
  status: z.string().default("final"),
  /** "high" | "low" | "unknown" confidence category. */
  confidenceCategory: z.string().default("unknown"),
  /** ASR provider/model id that produced the source text. */
  provider: z.string().max(64).default(""),
  /** Detected language token (tl/zh/en/…) when the caption exposed one. */
  detectedLanguage: z.string().max(16).default(""),
  /** Warnings attached to the caption (e.g. FORCED_SPLIT). */
  warnings: z.array(z.string()).default([]),
  /** Domain preset active when the caption was recorded. */
  preset: z.string().max(64).default(""),
  /** Live session id, when the session exposes one. */
  sessionId: z.string().max(64).default(""),
  /** End-to-end pipeline time the sidecar reported (capture → caption, ms). */
  latencyMs: z.number().nonnegative().default(0),
  /** True for the user's own mic stream / typed chat ("you" bubbles). */
  fromSelf: z.boolean().default(false),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historySessionSchema = z.object({
  /** Session id (sess-<epoch>); reused across starts when kept open. */
  id: z.string().min(1).max(64),
  /** Display name, editable by the user from the History page. */
  name: z.string().min(1).max(64),
  /** Wall-clock time the session started (ms). */
  startedAtMs: z.number().nonnegative(),
  /** Wall-clock end time (ms), null while the session stays open. */
  endedAtMs: z.number().nonnegative().nullable(),
  /** Final captions in chat order (oldest first, newest last). */
  entries: z.array(historyEntrySchema).max(SESSION_MAX_ENTRIES),
});

export type HistorySession = z.infer<typeof historySessionSchema>;

const HISTORY_STORAGE_KEY = "lst.captions.history.v2";
const LEGACY_STORAGE_KEY = "lst.captions.history.v1";

export const historyStateSchema = z.object({
  version: z.literal(2),
  sessions: z.array(historySessionSchema),
  /** The session live translation is currently appending to (null = none). */
  currentSessionId: z.string().max(64).nullable(),
});

export type HistoryState = z.infer<typeof historyStateSchema>;

export type HistoryAction =
  | { type: "record"; caption: Caption; context?: HistoryContext }
  | {
      type: "recordChat";
      /** Unique entry id (must not collide with caption ids). */
      id: string;
      /** Translated (target-language) text shown in the bubble. */
      text: string;
      /** The user's original typed text (source language). */
      sourceText: string;
      /** Translation provider label, e.g. "nllb". */
      provider?: string;
    }
  | { type: "beginSession"; id: string; name: string; startedAtMs?: number }
  | { type: "endSession"; id: string; endedAtMs?: number }
  | { type: "renameSession"; id: string; name: string }
  | { type: "deleteSession"; id: string }
  | { type: "selectSession"; id: string | null }
  | { type: "clearSession"; id: string }
  | { type: "clear" };

/** Session context stamped onto a recorded entry at finalization time. */
export type HistoryContext = {
  /** Who's talking: resolved source display name. */
  displayName?: string;
  /** Which audio input the session captures (mic / loopback / system). */
  audioSource?: string;
  /** ASR provider id that produced the source text (DS-900). */
  provider?: string;
  /** Domain preset active for the session (DS-900). */
  preset?: string;
  /** Live session id (DS-900). */
  sessionId?: string;
};

const DEDUPE_WINDOW_MS = 6_000;

export function emptyHistoryState(): HistoryState {
  return { version: 2, sessions: [], currentSessionId: null };
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

/** The transcript the overlay and History page show: the current session,
 * or the most recently started one when no session is live. */
export function currentSessionEntries(state: HistoryState): HistoryEntry[] {
  const current = state.sessions.find(
    (session) => session.id === state.currentSessionId,
  );
  if (current !== undefined) {
    return current.entries;
  }
  if (state.sessions.length === 0) {
    return [];
  }
  return (
    [...state.sessions].sort((a, b) => b.startedAtMs - a.startedAtMs)[0]
      ?.entries ?? []
  );
}

function entryForCaption(
  caption: Caption,
  context: HistoryContext,
): HistoryEntry {
  const text = caption.englishText.trim() || caption.sourceText.trim();
  const nowMs = Date.now();
  const sourceId = caption.source?.sourceId ?? "";
  return {
    id: caption.id,
    text,
    sourceText: caption.sourceText.trim(),
    sourceLabel: caption.source?.captionTag ?? "",
    sourceId,
    displayName: context.displayName ?? "",
    color: caption.source?.color ?? "",
    audioSource: context.audioSource ?? "",
    timestampMs: nowMs,
    uncertain: caption.certainty?.state === "uncertain",
    startedAtMs: caption.createdAtMs,
    status: caption.status,
    confidenceCategory:
      caption.certainty?.state === "uncertain" ? "low" : "high",
    provider: context.provider ?? "",
    detectedLanguage: "",
    warnings: [],
    preset: context.preset ?? "",
    sessionId: context.sessionId ?? "",
    latencyMs: caption.latencyMs ?? 0,
    fromSelf: sourceId === YOU_SOURCE_ID,
  };
}

function recordIntoSession(
  session: HistorySession,
  caption: Caption,
  context: HistoryContext,
): HistorySession {
  if (caption.status !== "final") {
    return session;
  }
  const entry = {
    ...entryForCaption(caption, context),
    sessionId: session.id,
  };
  if (entry.text === "") {
    return session;
  }
  const entries = session.entries.slice();
  // The same caption id upserts in place. Scoped to this session so a fresh
  // pipeline (new session) can never overwrite an older entry mid-list.
  const existing = entries.findIndex((candidate) => candidate.id === entry.id);
  if (existing !== -1) {
    entries[existing] = entry;
    return { ...session, entries };
  }
  // A repeated final (VAD overlap re-finalizing the same sentence) just
  // refreshes the timestamp instead of duplicating the line.
  const newest = entries[entries.length - 1];
  if (
    newest?.text === entry.text &&
    entry.timestampMs - newest.timestampMs < DEDUPE_WINDOW_MS
  ) {
    return {
      ...session,
      entries: [
        ...entries.slice(0, -1),
        { ...newest, timestampMs: entry.timestampMs },
      ],
    };
  }
  entries.push(entry);
  return { ...session, entries: entries.slice(-SESSION_MAX_ENTRIES) };
}

/** Pure reducer: finals only, in-place upsert per session, chat order.
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
      const current = state.sessions.findIndex(
        (session) => session.id === state.currentSessionId,
      );
      if (current === -1) {
        // No live session: captions are not recorded anywhere.
        return state;
      }
      const sessions = state.sessions.slice();
      const session = sessions[current];
      if (session === undefined) {
        return state;
      }
      sessions[current] = recordIntoSession(session, caption, context);
      return { ...state, sessions };
    }
    case "recordChat": {
      const current = state.sessions.findIndex(
        (session) => session.id === state.currentSessionId,
      );
      if (current === -1) {
        // No open session (e.g. standalone chat with no live run): record
        // nothing — the caller decides whether to open a session first.
        return state;
      }
      const sessions = state.sessions.slice();
      const session = sessions[current];
      if (session === undefined) {
        return state;
      }
      const nowMs = Date.now();
      const entry: HistoryEntry = {
        id: action.id,
        text: action.text.trim(),
        sourceText: action.sourceText.trim(),
        sourceLabel: "YOU",
        sourceId: YOU_SOURCE_ID,
        displayName: "You",
        color: YOU_ACCENT_COLOR,
        audioSource: "chat",
        timestampMs: nowMs,
        uncertain: false,
        startedAtMs: nowMs,
        status: "final",
        confidenceCategory: "high",
        provider: action.provider ?? "",
        detectedLanguage: "",
        warnings: [],
        preset: "",
        sessionId: session.id,
        latencyMs: 0,
        fromSelf: true,
      };
      if (entry.text === "") {
        return state;
      }
      sessions[current] = {
        ...session,
        entries: [...session.entries, entry].slice(-SESSION_MAX_ENTRIES),
      };
      return { ...state, sessions };
    }
    case "beginSession": {
      const { id, name, startedAtMs = Date.now() } = action;
      if (state.sessions.some((session) => session.id === id)) {
        // Reusing a kept-open session: just point the current session at it.
        return { ...state, currentSessionId: id };
      }
      return {
        version: 2,
        currentSessionId: id,
        sessions: [
          ...state.sessions,
          { id, name, startedAtMs, endedAtMs: null, entries: [] },
        ],
      };
    }
    case "endSession": {
      const { id, endedAtMs = Date.now() } = action;
      return {
        ...state,
        currentSessionId:
          state.currentSessionId === id ? null : state.currentSessionId,
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, endedAtMs } : session,
        ),
      };
    }
    case "renameSession": {
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id
            ? { ...session, name: action.name.trim() || session.name }
            : session,
        ),
      };
    }
    case "deleteSession": {
      return {
        ...state,
        currentSessionId:
          state.currentSessionId === action.id ? null : state.currentSessionId,
        sessions: state.sessions.filter((session) => session.id !== action.id),
      };
    }
    case "selectSession": {
      const { id } = action;
      return {
        ...state,
        currentSessionId:
          id !== null && state.sessions.some((session) => session.id === id)
            ? id
            : null,
      };
    }
    case "clearSession": {
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.id ? { ...session, entries: [] } : session,
        ),
      };
    }
  }
}

/** Migrates the v1 flat ring buffer into a single session so no transcript
 * is lost when upgrading. */
function migrateLegacyState(serialized: string): HistoryState | null {
  const legacySchema = z.object({
    version: z.literal(1),
    entries: z.array(historyEntrySchema),
  });
  const parsed = legacySchema.safeParse(JSON.parse(serialized));
  if (!parsed.success || parsed.data.entries.length === 0) {
    return null;
  }
  const entries = parsed.data.entries;
  return {
    version: 2,
    currentSessionId: null,
    sessions: [
      {
        id: "sess-imported",
        name: "Imported session",
        startedAtMs: entries[0]?.timestampMs ?? Date.now(),
        endedAtMs: entries[entries.length - 1]?.timestampMs ?? null,
        entries: entries.slice(-SESSION_MAX_ENTRIES),
      },
    ],
  };
}

export function loadHistoryState(
  storage: Pick<Storage, "getItem" | "removeItem"> = window.localStorage,
): HistoryState {
  const serialized = storage.getItem(HISTORY_STORAGE_KEY);
  if (serialized === null) {
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      try {
        const migrated = migrateLegacyState(legacy);
        if (migrated !== null) {
          storage.removeItem(LEGACY_STORAGE_KEY);
          return migrated;
        }
      } catch {
        // Fall through to an empty state.
      }
    }
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
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): void {
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state));
  storage.removeItem(LEGACY_STORAGE_KEY);
}

export function clearHistoryState(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(HISTORY_STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY);
}

/** Per-column display toggles for the History page (the "Settings" menu). */
export const historyDisplayOptionsSchema = z.object({
  showSource: z.boolean(),
  showSpeaker: z.boolean(),
  showTimestamp: z.boolean(),
  showLatency: z.boolean(),
  showModels: z.boolean(),
  /** Show the profile icon (avatar) beside each chat bubble. */
  showAvatars: z.boolean().default(true),
  /** "source" tints bubbles with their audio-source color; "default" keeps
   * the neutral theme bubble for everyone. */
  bubbleColor: z.enum(["source", "default"]).default("source"),
  /** History translation layout: "chat" = bubble chat, "classic" = the old
   * flat list (default; "you" entries stay right-aligned). */
  layout: z.enum(["chat", "classic"]).default("classic"),
  /** Solid background color of "you" bubbles ("#rrggbb"). */
  youColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3b82f6"),
});

export type HistoryDisplayOptions = z.infer<typeof historyDisplayOptionsSchema>;

const DISPLAY_OPTIONS_KEY = "lst.history.options.v3";
const LEGACY_OPTIONS_KEY = "lst.history.options.v2";
const LEGACY_SOURCE_KEY = "lst.history.showSource";

export const DEFAULT_DISPLAY_OPTIONS: HistoryDisplayOptions = {
  // Transcribed input stays off by default (matches the pre-sessions toggle,
  // which also defaulted to hiding the source line).
  showSource: false,
  showSpeaker: true,
  showTimestamp: true,
  showLatency: true,
  showModels: true,
  showAvatars: true,
  bubbleColor: "source",
  layout: "classic",
  youColor: "#3b82f6",
};

export function loadHistoryDisplayOptions(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): HistoryDisplayOptions {
  const serialized =
    storage.getItem(DISPLAY_OPTIONS_KEY) ?? storage.getItem(LEGACY_OPTIONS_KEY);
  if (serialized !== null) {
    try {
      const parsed = historyDisplayOptionsSchema.safeParse(
        JSON.parse(serialized),
      );
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Fall through to defaults.
    }
  }
  // v1 stored the transcribed toggle under its own key.
  if (storage.getItem(LEGACY_SOURCE_KEY) === "1") {
    return { ...DEFAULT_DISPLAY_OPTIONS, showSource: true };
  }
  return DEFAULT_DISPLAY_OPTIONS;
}

export function saveHistoryDisplayOptions(
  options: HistoryDisplayOptions,
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): void {
  storage.setItem(DISPLAY_OPTIONS_KEY, JSON.stringify(options));
  storage.removeItem(LEGACY_OPTIONS_KEY);
  storage.removeItem(LEGACY_SOURCE_KEY);
}
