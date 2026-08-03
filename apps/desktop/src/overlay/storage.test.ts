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

  it("migrates schemaVersion 1 documents to v2 with safe lane defaults", () => {
    const legacy = {
      schemaVersion: 1,
      monitorId: null,
      xNormalized: 0.4,
      yNormalized: 0.7,
      widthNormalized: 0.8,
      fontScale: 1.1,
      backgroundOpacity: 0.5,
      showSource: false,
      hotkeys: DEFAULT_OVERLAY_SETTINGS.hotkeys,
    };
    const storage = {
      getItem: () => JSON.stringify(legacy),
    };

    const migrated = loadOverlaySettings(storage);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.simultaneousPolicy).toBe("show-both");
    expect(migrated.primarySourceId).toBeNull();
    expect(migrated.hiddenSourceIds).toEqual([]);
    expect(migrated.showSource).toBe(false);
    expect(migrated.fontScale).toBe(1.1);
  });
});
