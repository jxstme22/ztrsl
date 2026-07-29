import { describe, expect, it } from "vitest";

import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "./model";
import { loadOverlaySettings, saveOverlaySettings } from "./storage";

describe("overlay settings storage", () => {
  it("falls back safely when persisted JSON is invalid", () => {
    const storage = {
      getItem: () => "{broken",
    };

    expect(loadOverlaySettings(storage)).toEqual(DEFAULT_OVERLAY_SETTINGS);
  });

  it("rejects out-of-bounds persisted values", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          ...DEFAULT_OVERLAY_SETTINGS,
          widthNormalized: 5,
        }),
    };

    expect(loadOverlaySettings(storage)).toEqual(DEFAULT_OVERLAY_SETTINGS);
  });

  it("writes versioned settings without content history", () => {
    let serialized = "";
    const storage = {
      setItem: (_key: string, value: string) => {
        serialized = value;
      },
    };
    const settings: OverlaySettings = {
      ...DEFAULT_OVERLAY_SETTINGS,
      showSource: false,
    };

    saveOverlaySettings(settings, storage);

    expect(JSON.parse(serialized)).toEqual(settings);
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("audio");
  });
});
