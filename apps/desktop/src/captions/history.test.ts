import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_ENTRIES,
  YOU_ACCENT_COLOR,
  YOU_SOURCE_ID,
  clearHistoryState,
  currentSessionEntries,
  historyReducer,
  loadHistoryDisplayOptions,
  loadHistoryState,
  saveHistoryDisplayOptions,
  saveHistoryState,
  visibleHistoryEntries,
  type HistoryState,
} from "./history";
import type { Caption } from "../overlay/model";

function caption(overrides: Partial<Caption> = {}): Caption {
  return {
    id: "c1",
    revision: 3,
    status: "final",
    sourceText: "sabihin mo",
    englishText: "Say it",
    createdAtMs: 1000,
    expiresAtMs: 5000,
    latencyMs: 0,
    certainty: {
      state: "normal",
      uncertaintyReasons: [],
      suppressionReason: null,
    },
    ...overrides,
  };
}

/** A ready-to-record state with a live session open. */
function liveState(
  sessionId = "sess-1",
  name = "Session · 08/08 14:30",
): HistoryState {
  return historyReducer(empty(), {
    type: "beginSession",
    id: sessionId,
    name,
    startedAtMs: 1000,
  });
}

function empty(): HistoryState {
  return { version: 2, sessions: [], currentSessionId: null };
}

function fakeStorage(
  initial: Record<string, string> = {},
): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe("historyReducer sessions", () => {
  it("ignores provisional captions", () => {
    const next = historyReducer(liveState(), {
      type: "record",
      caption: caption({ status: "provisional" }),
    });
    expect(next.sessions[0]?.entries).toHaveLength(0);
  });

  it("drops captions when no session is open", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption(),
    });
    expect(next.sessions).toHaveLength(0);
  });

  it("records finals into the current session with full context", () => {
    const next = historyReducer(liveState(), {
      type: "record",
      caption: caption({
        source: {
          sourceId: "0123456789abcdef0123456789abcdef",
          captionTag: "SRC",
          labelStyle: "brackets",
          captionAlignment: "center",
          color: "#ffcc00",
        },
        latencyMs: 640,
      }),
      context: {
        displayName: "Valorant Team",
        audioSource: "Headphones (loopback)",
        provider: "whisper-large-v3-turbo + nllb",
      },
    });
    expect(next.sessions[0]?.entries).toHaveLength(1);
    expect(next.sessions[0]?.entries[0]).toMatchObject({
      id: "c1",
      text: "Say it",
      sourceText: "sabihin mo",
      sourceLabel: "SRC",
      sourceId: "0123456789abcdef0123456789abcdef",
      displayName: "Valorant Team",
      color: "#ffcc00",
      audioSource: "Headphones (loopback)",
      provider: "whisper-large-v3-turbo + nllb",
      latencyMs: 640,
      sessionId: "sess-1",
      uncertain: false,
    });
    expect(next.sessions[0]?.entries[0]?.timestampMs).toBeGreaterThan(0);
  });

  it("upserts by id within its own session only", () => {
    const once = liveState();
    const withCaption = historyReducer(once, {
      type: "record",
      caption: caption({ id: "c1" }),
    });
    // The same caption id in a NEW session must not touch the old one —
    // that is the regression where a fresh pipeline overwrote an old entry
    // mid-list on the History page.
    const second = historyReducer(
      historyReducer(withCaption, {
        type: "endSession",
        id: "sess-1",
      }),
      { type: "beginSession", id: "sess-2", name: "Session · 14:45" },
    );
    const withSameId = historyReducer(second, {
      type: "record",
      caption: caption({ id: "c1", englishText: "Say it louder" }),
    });
    expect(withSameId.sessions[0]?.entries).toHaveLength(1);
    expect(withSameId.sessions[0]?.entries[0]?.text).toBe("Say it");
    expect(withSameId.sessions[1]?.entries).toHaveLength(1);
    expect(withSameId.sessions[1]?.entries[0]?.text).toBe("Say it louder");
  });

  it("merges a consecutive duplicate final within the dedupe window", () => {
    const once = historyReducer(liveState(), {
      type: "record",
      caption: caption({ id: "c1", englishText: "Rotate B" }),
    });
    const twice = historyReducer(once, {
      type: "record",
      caption: caption({ id: "c2", englishText: "Rotate B" }),
    });
    expect(twice.sessions[0]?.entries).toHaveLength(1);
  });

  it("keeps chat order: oldest first, newest appended last", () => {
    let state = liveState();
    for (let index = 0; index < 3; index += 1) {
      state = historyReducer(state, {
        type: "record",
        caption: caption({
          id: "c" + String(index),
          englishText: "line " + String(index),
        }),
      });
    }
    expect(state.sessions[0]?.entries.map((e) => e.text)).toEqual([
      "line 0",
      "line 1",
      "line 2",
    ]);
  });

  it("keeps everything (no 10-entry ring); safety cap at SESSION_MAX_ENTRIES", () => {
    let state = liveState();
    for (let index = 0; index < SESSION_MAX_ENTRIES + 25; index += 1) {
      state = historyReducer(state, {
        type: "record",
        caption: caption({
          id: "c" + String(index),
          englishText: "line " + String(index),
        }),
      });
    }
    expect(state.sessions[0]?.entries).toHaveLength(SESSION_MAX_ENTRIES);
    expect(state.sessions[0]?.entries[0]?.text).toBe("line 25");
    expect(state.sessions[0]?.entries.at(-1)?.text).toBe(
      "line " + String(SESSION_MAX_ENTRIES + 24),
    );
  });

  it("marks uncertain finals", () => {
    const next = historyReducer(liveState(), {
      type: "record",
      caption: caption({
        certainty: {
          state: "uncertain",
          uncertaintyReasons: ["low_score"],
          suppressionReason: null,
        },
      }),
    });
    expect(next.sessions[0]?.entries[0]?.uncertain).toBe(true);
  });

  it("falls back to the source text when the translation is empty", () => {
    const next = historyReducer(liveState(), {
      type: "record",
      caption: caption({ englishText: "   " }),
    });
    expect(next.sessions[0]?.entries[0]?.text).toBe("sabihin mo");
  });
});

describe("historyReducer session lifecycle", () => {
  it("beginSession creates a session and makes it current", () => {
    const next = historyReducer(empty(), {
      type: "beginSession",
      id: "sess-1",
      name: "Session · 08/08 14:30",
    });
    expect(next.currentSessionId).toBe("sess-1");
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0]).toMatchObject({
      id: "sess-1",
      name: "Session · 08/08 14:30",
      endedAtMs: null,
      entries: [],
    });
  });

  it("beginSession on an existing id just points the current session at it", () => {
    const started = historyReducer(empty(), {
      type: "beginSession",
      id: "sess-1",
      name: "Session · 08/08 14:30",
    });
    const next = historyReducer(
      historyReducer(started, {
        type: "endSession",
        id: "sess-1",
      }),
      {
        type: "beginSession",
        id: "sess-1",
        name: "Session · 08/08 14:30",
      },
    );
    expect(next.sessions).toHaveLength(1);
    expect(next.currentSessionId).toBe("sess-1");
  });

  it("endSession stamps the end time and clears the current session", () => {
    const state = historyReducer(liveState(), {
      type: "endSession",
      id: "sess-1",
      endedAtMs: 99,
    });
    expect(state.currentSessionId).toBeNull();
    expect(state.sessions[0]?.endedAtMs).toBe(99);
  });

  it("keep-open: current session survives a plain stop (no endSession)", () => {
    const next = historyReducer(liveState(), {
      type: "endSession",
      id: "sess-1",
    });
    expect(next.currentSessionId).toBeNull();
  });

  it("renameSession trims and refuses blank names", () => {
    const renamed = historyReducer(liveState(), {
      type: "renameSession",
      id: "sess-1",
      name: "  Round 3  ",
    });
    expect(renamed.sessions[0]?.name).toBe("Round 3");
    const blank = historyReducer(renamed, {
      type: "renameSession",
      id: "sess-1",
      name: "   ",
    });
    expect(blank.sessions[0]?.name).toBe("Round 3");
  });

  it("deleteSession removes the session and clears the current id", () => {
    const state = historyReducer(liveState(), {
      type: "deleteSession",
      id: "sess-1",
    });
    expect(state.sessions).toHaveLength(0);
    expect(state.currentSessionId).toBeNull();
  });

  it("selectSession validates the id and allows null", () => {
    const state = liveState();
    expect(
      historyReducer(state, { type: "selectSession", id: "nope" })
        .currentSessionId,
    ).toBeNull();
    expect(
      historyReducer(state, { type: "selectSession", id: "sess-1" })
        .currentSessionId,
    ).toBe("sess-1");
    expect(
      historyReducer(state, { type: "selectSession", id: null })
        .currentSessionId,
    ).toBeNull();
  });

  it("clearSession empties only the targeted session's entries", () => {
    const withEntry = historyReducer(liveState(), {
      type: "record",
      caption: caption(),
    });
    const next = historyReducer(withEntry, {
      type: "clearSession",
      id: "sess-1",
    });
    expect(next.sessions[0]?.entries).toHaveLength(0);
    expect(next.currentSessionId).toBe("sess-1");
  });

  it("clear resets everything", () => {
    const state = historyReducer(
      historyReducer(liveState(), {
        type: "record",
        caption: caption(),
      }),
      { type: "clear" },
    );
    expect(state).toEqual(empty());
  });
});

describe("history storage", () => {
  it("round-trips v2 state through localStorage", () => {
    const storage = fakeStorage();
    const state = historyReducer(liveState(), {
      type: "record",
      caption: caption(),
    });
    saveHistoryState(state, storage);
    expect(loadHistoryState(storage)).toEqual(state);
  });

  it("migrates a v1 flat buffer into a single imported session", () => {
    const legacy = JSON.stringify({
      version: 1,
      entries: [
        {
          id: "old-1",
          text: "Old line",
          sourceText: "",
          sourceLabel: "",
          sourceId: "",
          displayName: "",
          color: "",
          audioSource: "",
          timestampMs: 1000,
          uncertain: false,
        },
      ],
    });
    const storage = fakeStorage({ "lst.captions.history.v1": legacy });
    const state = loadHistoryState(storage);
    expect(state.version).toBe(2);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.id).toBe("sess-imported");
    expect(state.sessions[0]?.entries[0]?.text).toBe("Old line");
    expect(storage.getItem("lst.captions.history.v1")).toBeNull();
  });

  it("recovers from corrupted payloads", () => {
    const storage = fakeStorage({ "lst.captions.history.v2": "{nope" });
    expect(loadHistoryState(storage)).toEqual(empty());
  });

  it("recovers from corrupted legacy payloads", () => {
    const storage = fakeStorage({ "lst.captions.history.v1": "{nope" });
    expect(loadHistoryState(storage)).toEqual(empty());
  });

  it("clear removes both storage keys", () => {
    const storage = fakeStorage({
      "lst.captions.history.v2": "{}",
      "lst.captions.history.v1": "{}",
    });
    clearHistoryState(storage);
    expect(storage.getItem("lst.captions.history.v2")).toBeNull();
    expect(storage.getItem("lst.captions.history.v1")).toBeNull();
  });
});

describe("currentSessionEntries", () => {
  it("prefers the current session", () => {
    const state = historyReducer(
      historyReducer(liveState("sess-1"), {
        type: "record",
        caption: caption({ id: "a" }),
      }),
      { type: "beginSession", id: "sess-2", name: "Session · 14:45" },
    );
    const next = historyReducer(state, {
      type: "record",
      caption: caption({ id: "b" }),
    });
    expect(currentSessionEntries(next).map((e) => e.id)).toEqual(["b"]);
  });

  it("falls back to the most recently started session", () => {
    const state = historyReducer(
      historyReducer(liveState("sess-1"), {
        type: "record",
        caption: caption({ id: "a" }),
      }),
      { type: "endSession", id: "sess-1" },
    );
    const older = historyReducer(state, {
      type: "beginSession",
      id: "sess-2",
      name: "Session · 14:45",
      startedAtMs: 5000,
    });
    const newest = historyReducer(older, {
      type: "beginSession",
      id: "sess-3",
      name: "Session · 15:00",
      startedAtMs: 9000,
    });
    const recorded = historyReducer(
      historyReducer(newest, {
        type: "record",
        caption: caption({ id: "b" }),
      }),
      { type: "endSession", id: "sess-3" },
    );
    expect(currentSessionEntries(recorded).map((e) => e.id)).toEqual(["b"]);
  });

  it("returns an empty list with no sessions", () => {
    expect(currentSessionEntries(empty())).toEqual([]);
  });
});

describe("history display options", () => {
  it("round-trips through localStorage", () => {
    const storage = fakeStorage();
    const options = {
      showSource: false,
      showSpeaker: true,
      showTimestamp: false,
      showLatency: true,
      showModels: true,
      showAvatars: true,
      bubbleColor: "source" as const,
      layout: "classic" as const,
    };
    saveHistoryDisplayOptions(options, storage);
    expect(loadHistoryDisplayOptions(storage)).toEqual(options);
  });

  it("defaults to everything visible except the transcribed input", () => {
    expect(loadHistoryDisplayOptions(fakeStorage())).toEqual({
      showSource: false,
      showSpeaker: true,
      showTimestamp: true,
      showLatency: true,
      showModels: true,
      showAvatars: true,
      bubbleColor: "source",
      layout: "classic",
    });
  });

  it("migrates the legacy showSource toggle", () => {
    const storage = fakeStorage({ "lst.history.showSource": "1" });
    expect(loadHistoryDisplayOptions(storage).showSource).toBe(true);
  });

  it("recovers from corrupted payloads", () => {
    const storage = fakeStorage({ "lst.history.options.v2": "{nope" });
    expect(loadHistoryDisplayOptions(storage).showSource).toBe(false);
  });
});

describe("visibleHistoryEntries", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: `c${String(i)}`,
    text: `entry ${String(i)}`,
    sourceText: "",
    sourceLabel: "",
    sourceId: "",
    displayName: "",
    color: "",
    audioSource: "",
    timestampMs: i * 1000,
    uncertain: false,
    startedAtMs: 0,
    status: "final",
    confidenceCategory: "high",
    provider: "",
    detectedLanguage: "",
    warnings: [],
    preset: "",
    sessionId: "",
    latencyMs: 0,
    fromSelf: false,
  }));

  it("keeps every buffered entry in auto mode", () => {
    expect(visibleHistoryEntries(entries, "auto")).toHaveLength(12);
  });

  it("keeps only the newest 10 lines", () => {
    const shown = visibleHistoryEntries(entries, 10);
    expect(shown).toHaveLength(10);
    expect(shown[0]?.text).toBe("entry 2");
    expect(shown.at(-1)?.text).toBe("entry 11");
  });

  it("keeps only the newest 5 lines", () => {
    const shown = visibleHistoryEntries(entries, 5);
    expect(shown).toHaveLength(5);
    expect(shown[0]?.text).toBe("entry 7");
    expect(shown.at(-1)?.text).toBe("entry 11");
  });

  it("does not mutate the buffer", () => {
    const before = entries.length;
    visibleHistoryEntries(entries, 5);
    expect(entries).toHaveLength(before);
  });
});

describe("historyReducer recordChat", () => {
  it("records a typed-chat bubble as a 'you' entry", () => {
    const next = historyReducer(liveState("sess-1"), {
      type: "recordChat",
      id: "chat-1",
      text: "Hello there",
      sourceText: "你好",
      provider: "nllb",
    });
    const entries = next.sessions[0]?.entries ?? [];
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.fromSelf).toBe(true);
    expect(entry?.displayName).toBe("You");
    expect(entry?.sourceLabel).toBe("YOU");
    expect(entry?.sourceId).toBe(YOU_SOURCE_ID);
    expect(entry?.color).toBe(YOU_ACCENT_COLOR);
    expect(entry?.text).toBe("Hello there");
    expect(entry?.sourceText).toBe("你好");
    expect(entry?.provider).toBe("nllb");
  });

  it("drops empty chat bubbles", () => {
    const next = historyReducer(liveState("sess-1"), {
      type: "recordChat",
      id: "chat-1",
      text: "   ",
      sourceText: "",
    });
    expect(next.sessions[0]?.entries ?? []).toHaveLength(0);
  });

  it("records nothing when no session is open", () => {
    const next = historyReducer(empty(), {
      type: "recordChat",
      id: "chat-1",
      text: "Hello",
      sourceText: "",
    });
    expect(next.sessions).toHaveLength(0);
  });

  it("caps chat bubbles at the session entry limit", () => {
    const state = empty();
    const id = "sess-big";
    let next = historyReducer(state, { type: "beginSession", id, name: "Big" });
    for (let index = 0; index < SESSION_MAX_ENTRIES; index += 1) {
      next = historyReducer(next, {
        type: "recordChat",
        id: `chat-${String(index)}`,
        text: `message ${String(index)}`,
        sourceText: "",
      });
    }
    const session = next.sessions.find((s) => s.id === id);
    expect(session?.entries).toHaveLength(SESSION_MAX_ENTRIES);
    expect(session?.entries[0]?.text).toBe("message 0");
  });
});

describe("history entries from the you-mic source", () => {
  it("marks captions from the fixed you-source id as fromSelf", () => {
    const next = historyReducer(liveState("sess-1"), {
      type: "record",
      caption: caption({
        source: {
          sourceId: YOU_SOURCE_ID,
          captionTag: "YOU",
          labelStyle: "brackets",
          captionAlignment: "center",
          color: YOU_ACCENT_COLOR,
        },
      }),
    });
    const entry = next.sessions[0]?.entries[0];
    expect(entry?.fromSelf).toBe(true);
  });

  it("keeps teammate captions as non-self", () => {
    const next = historyReducer(liveState("sess-1"), {
      type: "record",
      caption: caption({
        source: {
          sourceId: "0123456789abcdef0123456789abcdef",
          captionTag: "TEAM",
          labelStyle: "brackets",
          captionAlignment: "center",
          color: "#7dd3fc",
        },
      }),
    });
    const entry = next.sessions[0]?.entries[0];
    expect(entry?.fromSelf).toBe(false);
  });
});
