import { describe, expect, it } from "vitest";

import { clipResultSchema, formatTimestamp } from "./model";

describe("clip model", () => {
  it("formats clip-relative timestamps", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(65_900)).toBe("01:05");
  });

  it("rejects a result that claims a real mode", () => {
    expect(() =>
      clipResultSchema.parse({
        metadata: {
          display_name: "clip.mp4",
          duration_seconds: 1,
          size_bytes: 4,
          has_audio: true,
        },
        captions: [],
        truncated: false,
        mode: "real",
      }),
    ).toThrow();
  });
});
