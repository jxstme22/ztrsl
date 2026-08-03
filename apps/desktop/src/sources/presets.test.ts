import { describe, expect, it } from "vitest";

import {
  createSourceFromPreset,
  getSourcePreset,
  SOURCE_PRESETS,
} from "./presets";
import { isValidSourceId } from "./identity";

describe("source presets", () => {
  it("exposes the five spec presets", () => {
    expect(SOURCE_PRESETS.map((p) => p.id)).toEqual([
      "valorant-team",
      "discord",
      "party-chat",
      "browser-voice",
      "custom",
    ]);
  });

  it("creates sources from presets with fresh immutable ids", () => {
    for (const preset of SOURCE_PRESETS) {
      const source = createSourceFromPreset(preset.id);
      expect(isValidSourceId(source.sourceId)).toBe(true);
      expect(source.displayName).toBe(preset.displayName);
      expect(source.captionTag).toBe(preset.captionTag);
    }
  });

  it("applies overrides without touching the id", () => {
    const source = createSourceFromPreset("valorant-team", {
      captionTag: "MY-TEAM",
    });
    expect(source.captionTag).toBe("MY-TEAM");
    expect(source.displayName).toBe("Valorant Team");
  });

  it("generates distinct ids per preset instantiation", () => {
    const a = createSourceFromPreset("discord");
    const b = createSourceFromPreset("discord");
    expect(a.sourceId).not.toBe(b.sourceId);
  });

  it("throws on unknown presets", () => {
    expect(() => getSourcePreset("nope" as never)).toThrow(
      /unknown source preset/,
    );
  });
});
