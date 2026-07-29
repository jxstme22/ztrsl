import { describe, expect, it } from "vitest";

import type { Caption } from "./model";
import { captionReducer, readingDurationMs } from "./reducer";

function caption(
  id: string,
  revision: number,
  status: Caption["status"] = "provisional",
): Caption {
  return {
    id,
    revision,
    status,
    sourceText: "Adto ta sa B.",
    englishText: "Let's go B.",
    createdAtMs: revision * 100,
    expiresAtMs: 5_000,
  };
}

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
});

describe("readingDurationMs", () => {
  it("clamps very short and long captions", () => {
    expect(readingDurationMs("Go B")).toBe(2_000);
    expect(readingDurationMs("x".repeat(500))).toBe(7_000);
  });
});
