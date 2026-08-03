import { describe, expect, it } from "vitest";

import {
  SOURCE_CONFIGS_KEY,
  loadSourceConfigs,
  removeSourceConfigs,
  saveSourceConfigs,
} from "./storage";
import { sourceConfigsSchema } from "./model";
import { loadOverlaySettings } from "../overlay/storage";

class MemoryStorage implements Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const OVERLAY_KEY = "local-squad-translator.overlay.v1";

describe("source config storage", () => {
  it("round-trips a saved document", () => {
    const storage = new MemoryStorage();
    const first = loadSourceConfigs(storage);
    const firstSource = first.sources[0];
    if (firstSource === undefined) {
      throw new Error("expected a migrated source");
    }
    firstSource.captionTag = "TEAM2";
    saveSourceConfigs(first, storage);
    expect(loadSourceConfigs(storage)).toEqual(first);
  });

  it("migrates from v0.2 on first load and persists the document", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      OVERLAY_KEY,
      JSON.stringify({
        schemaVersion: 1,
        monitorId: null,
        xNormalized: 0.5,
        yNormalized: 0.72,
        widthNormalized: 0.8,
        fontScale: 1,
        backgroundOpacity: 0.45,
        showSource: false,
        hotkeys: {
          toggleOverlay: "CommandOrControl+Shift+T",
          toggleTranslation: "CommandOrControl+Shift+Y",
          toggleEditMode: "CommandOrControl+Shift+E",
          clearCaptions: "CommandOrControl+Shift+Backspace",
          increaseText: "CommandOrControl+Shift+=",
          decreaseText: "CommandOrControl+Shift+-",
        },
      }),
    );
    const configs = loadSourceConfigs(storage);
    expect(configs.sources[0]?.labelStyle).toBe("hidden");
    const persisted: unknown = JSON.parse(
      storage.getItem(SOURCE_CONFIGS_KEY) ?? "{}",
    );
    expect(sourceConfigsSchema.safeParse(persisted).success).toBe(true);
  });

  it("returns a stable document across repeated loads (id stable)", () => {
    const storage = new MemoryStorage();
    const a = loadSourceConfigs(storage);
    const b = loadSourceConfigs(storage);
    expect(a.sources[0]?.sourceId).toBe(b.sources[0]?.sourceId);
  });

  it("falls back to migration on corrupt payload", () => {
    const storage = new MemoryStorage();
    storage.setItem(SOURCE_CONFIGS_KEY, "{not json");
    const configs = loadSourceConfigs(storage);
    expect(sourceConfigsSchema.safeParse(configs).success).toBe(true);
  });

  it("falls back to migration on schema-invalid payload", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SOURCE_CONFIGS_KEY,
      JSON.stringify({ schemaVersion: 3, sources: [] }),
    );
    const configs = loadSourceConfigs(storage);
    expect(configs.sources.length).toBeGreaterThanOrEqual(1);
  });

  it("removes the document", () => {
    const storage = new MemoryStorage();
    loadSourceConfigs(storage);
    removeSourceConfigs(storage);
    expect(storage.getItem(SOURCE_CONFIGS_KEY)).toBeNull();
  });

  it("does not touch the overlay settings key", () => {
    const storage = new MemoryStorage();
    storage.setItem(OVERLAY_KEY, "{}");
    loadSourceConfigs(storage);
    expect(storage.getItem(OVERLAY_KEY)).toBe("{}");
    // An empty stored document still loads the current (v2) defaults and the
    // source loader must not have persisted anything to the overlay key.
    expect(loadOverlaySettings(storage).schemaVersion).toBe(2);
  });
});
