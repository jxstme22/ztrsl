import { describe, expect, it } from "vitest";

import type { Caption, CaptionSource } from "./model";
import {
  captionReducer,
  readingDurationMs,
  selectVisibleCaptions,
} from "./reducer";

function caption(
  id: string,
  revision: number,
  status: Caption["status"] = "provisional",
  createdAtMs = revision * 100,
): Caption {
  return {
    id,
    revision,
    status,
    sourceText: "Adto ta sa B.",
    englishText: "Let's go B.",
    createdAtMs,
    expiresAtMs: 5_000,
  };
}

function sourcedCaption(
  id: string,
  sourceId: string,
  revision: number,
  createdAtMs: number,
  tag = "TEAM",
): Caption {
  const source: CaptionSource = {
    sourceId,
    captionTag: tag,
    labelStyle: "brackets",
    color: null,
  };
  return {
    ...caption(id, revision, "final", createdAtMs),
    source,
  };
}

const TEAM = "11111111111111111111111111111111";
const DISCORD = "22222222222222222222222222222222";

const settings = {
  primarySourceId: null,
  hiddenSourceIds: [] as string[],
  simultaneousPolicy: "show-both" as const,
};

describe("captionReducer", () => {
  it("rejects stale revisions", () => {
    const current = captionReducer([], {
      type: "upsert",
      caption: caption("one", 2),
    });

    expect(
      captionReducer(current, {
        type: "upsert",
        caption: caption("one", 1),
      }),
    ).toEqual(current);
  });

  it("treats final captions as terminal", () => {
    const current = captionReducer([], {
      type: "upsert",
      caption: caption("one", 2, "final"),
    });

    expect(
      captionReducer(current, {
        type: "upsert",
        caption: caption("one", 3),
      }),
    ).toEqual(current);
  });

  it("expires captions using a deterministic clock value", () => {
    const current = [caption("expired", 1), caption("active", 2)].map(
      (item, index) => ({
        ...item,
        expiresAtMs: index === 0 ? 999 : 1_001,
      }),
    );

    expect(captionReducer(current, { type: "expire", nowMs: 1_000 })).toEqual([
      current[1],
    ]);
  });

  it("keeps only the two newest captions", () => {
    const first = captionReducer([], {
      type: "upsert",
      caption: caption("one", 1),
    });
    const second = captionReducer(first, {
      type: "upsert",
      caption: caption("two", 2),
    });
    const third = captionReducer(second, {
      type: "upsert",
      caption: caption("three", 3),
    });

    expect(third.map((item) => item.id)).toEqual(["two", "three"]);
  });

  it("keeps one caption per source lane instead of evicting across sources", () => {
    let state = captionReducer([], {
      type: "upsert",
      caption: sourcedCaption("team-1", TEAM, 1, 100),
    });
    state = captionReducer(state, {
      type: "upsert",
      caption: sourcedCaption("discord-1", DISCORD, 1, 200),
    });
    state = captionReducer(state, {
      type: "upsert",
      caption: sourcedCaption("team-2", TEAM, 2, 300),
    });

    const keys = state.map((item) => item.id).sort();
    expect(keys).toEqual(["discord-1", "team-2"]);
  });
});

describe("readingDurationMs", () => {
  it("clamps very short and long captions", () => {
    expect(readingDurationMs("Go B")).toBe(2_000);
    expect(readingDurationMs("x".repeat(500))).toBe(7_000);
  });
});

describe("selectVisibleCaptions", () => {
  const team = sourcedCaption("team", TEAM, 1, 300, "TEAM");
  const discord = sourcedCaption("discord", DISCORD, 1, 200, "DISCORD");

  it("show-both renders newest lane first then the other", () => {
    const visible = selectVisibleCaptions([team, discord], settings);
    expect(visible.map((item) => item.id)).toEqual(["team", "discord"]);
  });

  it("newest-wins renders only the newest caption", () => {
    const visible = selectVisibleCaptions([team, discord], {
      ...settings,
      simultaneousPolicy: "newest-wins",
    });
    expect(visible.map((item) => item.id)).toEqual(["team"]);
  });

  it("primary-wins renders only the primary source lane", () => {
    const visible = selectVisibleCaptions([team, discord], {
      ...settings,
      primarySourceId: DISCORD,
      simultaneousPolicy: "primary-wins",
    });
    expect(visible.map((item) => item.id)).toEqual(["discord"]);
  });

  it("primary-wins falls back to newest when primary has no caption", () => {
    const visible = selectVisibleCaptions([discord], {
      ...settings,
      primarySourceId: TEAM,
      simultaneousPolicy: "primary-wins",
    });
    expect(visible.map((item) => item.id)).toEqual(["discord"]);
  });

  it("show-both pins the primary source as the first lane", () => {
    const visible = selectVisibleCaptions([team, discord], {
      ...settings,
      primarySourceId: TEAM,
    });
    expect(visible.map((item) => item.id)).toEqual(["team", "discord"]);
  });

  it("hides captions from hidden sources", () => {
    const visible = selectVisibleCaptions([team, discord], {
      ...settings,
      hiddenSourceIds: [DISCORD],
    });
    expect(visible.map((item) => item.id)).toEqual(["team"]);
  });

  it("renders nothing when every caption is hidden", () => {
    const visible = selectVisibleCaptions([team, discord], {
      ...settings,
      hiddenSourceIds: [TEAM, DISCORD],
    });
    expect(visible).toEqual([]);
  });

  it("returns empty for an empty state", () => {
    expect(selectVisibleCaptions([], settings)).toEqual([]);
  });
});
