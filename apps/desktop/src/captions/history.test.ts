import { describe, expect, it } from "vitest";

import {
  CAPTION_HISTORY_LIMIT,
  clearHistoryState,
  historyReducer,
  historyStateSchema,
  loadHistoryState,
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
    certainty: {
      state: "normal",
      uncertaintyReasons: [],
      suppressionReason: null,
    },
    ...overrides,
  };
}

function empty(): HistoryState {
  return { version: 1, entries: [] };
}

describe("historyReducer", () => {
  it("ignores provisional captions", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption({ status: "provisional" }),
    });
    expect(next.entries).toHaveLength(0);
  });

  it("records final captions with source label, color and timestamp", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption({
        source: {
          sourceId: "0123456789abcdef0123456789abcdef",
          captionTag: "SRC",
          labelStyle: "brackets",
          captionAlignment: "center",
          color: "#ffcc00",
        },
      }),
      context: {
        displayName: "Valorant Team",
        audioSource: "Headphones (loopback)",
      },
    });
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      id: "c1",
      text: "Say it",
      sourceText: "sabihin mo",
      sourceLabel: "SRC",
      sourceId: "0123456789abcdef0123456789abcdef",
      displayName: "Valorant Team",
      color: "#ffcc00",
      audioSource: "Headphones (loopback)",
      uncertain: false,
    });
    expect(next.entries[0]?.timestampMs).toBeGreaterThan(0);
  });

  it("keeps the transcribed input on the entry", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption(),
    });
    expect(next.entries[0]?.sourceText).toBe("sabihin mo");
  });

  it("defaults sourceText to empty for legacy stored entries", () => {
    const parsed = historyStateSchema.safeParse({
      version: 1,
      entries: [
        {
          id: "legacy",
          text: "Say it",
          sourceLabel: "",
          sourceId: "",
          displayName: "",
          color: "",
          audioSource: "",
          timestampMs: 1,
          uncertain: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries[0]?.sourceText).toBe("");
    }
  });

  it("falls back to the source text when the translation is empty", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption({ englishText: "   " }),
    });
    expect(next.entries[0]?.text).toBe("sabihin mo");
  });

  it("drops captions with no text at all", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption({ englishText: "", sourceText: "" }),
    });
    expect(next.entries).toHaveLength(0);
  });

  it("upserts by id in place (final replaces its provisional slot)", () => {
    const once = historyReducer(empty(), {
      type: "record",
      caption: caption({ id: "c1" }),
    });
    const twice = historyReducer(once, {
      type: "record",
      caption: caption({ id: "c1", englishText: "Say it louder" }),
    });
    expect(twice.entries).toHaveLength(1);
    expect(twice.entries[0]?.text).toBe("Say it louder");
  });

  it("merges a consecutive duplicate final within the dedupe window", () => {
    const once = historyReducer(empty(), {
      type: "record",
      caption: caption({ id: "c1", englishText: "Rotate B" }),
    });
    const twice = historyReducer(once, {
      type: "record",
      caption: caption({ id: "c2", englishText: "Rotate B" }),
    });
    expect(twice.entries).toHaveLength(1);
  });

  it("keeps chat order: oldest first, newest appended last", () => {
    let state = empty();
    for (let index = 0; index < 3; index += 1) {
      state = historyReducer(state, {
        type: "record",
        caption: caption({
          id: "c" + String(index),
          englishText: "line " + String(index),
        }),
      });
    }
    expect(state.entries.map((entry) => entry.text)).toEqual([
      "line 0",
      "line 1",
      "line 2",
    ]);
  });

  it("caps the buffer at 10 entries, keeping the newest at the bottom", () => {
    let state = empty();
    for (let index = 0; index < 15; index += 1) {
      state = historyReducer(state, {
        type: "record",
        caption: caption({
          id: "c" + String(index),
          englishText: "line " + String(index),
        }),
      });
    }
    expect(state.entries).toHaveLength(CAPTION_HISTORY_LIMIT);
    expect(state.entries[0]?.text).toBe("line 5");
    expect(state.entries[9]?.text).toBe("line 14");
  });

  it("clears", () => {
    const state = historyReducer(empty(), {
      type: "record",
      caption: caption(),
    });
    expect(historyReducer(state, { type: "clear" }).entries).toHaveLength(0);
  });

  it("marks uncertain finals", () => {
    const next = historyReducer(empty(), {
      type: "record",
      caption: caption({
        certainty: {
          state: "uncertain",
          uncertaintyReasons: ["low_score"],
          suppressionReason: null,
        },
      }),
    });
    expect(next.entries[0]?.uncertain).toBe(true);
  });
});

describe("history storage", () => {
  it("round-trips through localStorage", () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const state = historyReducer(empty(), {
      type: "record",
      caption: caption(),
    });
    saveHistoryState(state, fakeStorage);
    expect(loadHistoryState(fakeStorage)).toEqual(state);
  });

  it("recovers from corrupted payloads", () => {
    const storage = new Map<string, string>([
      ["lst.captions.history.v1", "{nope"],
    ]);
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadHistoryState(fakeStorage)).toEqual(empty());
  });

  it("clear removes the key", () => {
    const storage = new Map<string, string>([
      ["lst.captions.history.v1", "{}"],
    ]);
    clearHistoryState({
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    expect(storage.has("lst.captions.history.v1")).toBe(false);
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
