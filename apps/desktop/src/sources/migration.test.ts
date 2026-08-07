import { describe, expect, it } from "vitest";

import type { OverlaySettings } from "../overlay/model";
import { migrateFromV02, migrateFromV03 } from "./migration";
import { sourceConfigsSchema } from "./model";
import { isValidSourceId } from "./identity";

const SEQUENTIAL_RANDOM = () => 0.5;

const BASE_OVERLAY: OverlaySettings = {
  schemaVersion: 2,
  monitorId: null,
  xNormalized: 0.5,
  yNormalized: 0.72,
  widthNormalized: 0.8,
  heightNormalized: 0.17,
  fontScale: 1,
  backgroundOpacity: 0.45,
  showSource: true,
  captionAlignment: "center",
  primarySourceId: null,
  hiddenSourceIds: [],
  simultaneousPolicy: "show-both",
  overlayContent: "captions",
  historyMaxRows: "auto",
  hotkeys: {
    toggleOverlay: "CommandOrControl+Shift+T",
    toggleTranslation: "CommandOrControl+Shift+Y",
    toggleEditMode: "CommandOrControl+Shift+E",
    clearCaptions: "CommandOrControl+Shift+Backspace",
    increaseText: "CommandOrControl+Shift+=",
    decreaseText: "CommandOrControl+Shift+-",
    toggleHistory: "CommandOrControl+Shift+H",
  },
};

describe("migrateFromV02", () => {
  it("creates one migrated source on first run", () => {
    const { configs, migrated } = migrateFromV02(
      null,
      BASE_OVERLAY,
      SEQUENTIAL_RANDOM,
    );
    expect(migrated).toBe(true);
    expect(sourceConfigsSchema.safeParse(configs).success).toBe(true);
    expect(configs.sources).toHaveLength(1);
    expect(configs.sources[0]?.displayName).toBe("Valorant Team");
    expect(configs.sources[0]?.captionTag).toBe("TEAM");
    expect(isValidSourceId(configs.sources[0]?.sourceId ?? "")).toBe(true);
  });

  it("is idempotent when a v3 document already exists", () => {
    const first = migrateFromV02(null, BASE_OVERLAY, SEQUENTIAL_RANDOM);
    const second = migrateFromV02(
      first.configs,
      BASE_OVERLAY,
      SEQUENTIAL_RANDOM,
    );
    expect(second.migrated).toBe(false);
    expect(second.configs).toEqual(first.configs);
  });

  it("keeps the migrated source id stable across calls", () => {
    const first = migrateFromV02(null, BASE_OVERLAY, SEQUENTIAL_RANDOM);
    const again = migrateFromV02(first.configs, null, SEQUENTIAL_RANDOM);
    expect(again.configs.sources[0]?.sourceId).toBe(
      first.configs.sources[0]?.sourceId,
    );
  });

  it("maps showSource=false to a hidden label style", () => {
    const { configs } = migrateFromV02(
      null,
      { ...BASE_OVERLAY, showSource: false },
      SEQUENTIAL_RANDOM,
    );
    expect(configs.sources[0]?.labelStyle).toBe("hidden");
  });

  it("keeps default label style when showSource is true", () => {
    const { configs } = migrateFromV02(null, BASE_OVERLAY, SEQUENTIAL_RANDOM);
    expect(configs.sources[0]?.labelStyle).toBe("brackets");
  });

  it("migrates with no overlay settings at all", () => {
    const { configs, migrated } = migrateFromV02(null, null, SEQUENTIAL_RANDOM);
    expect(migrated).toBe(true);
    expect(configs.sources[0]?.labelStyle).toBe("brackets");
  });

  it("ignores garbage v0.2 overlay state (null is passed by the loader)", () => {
    const { configs } = migrateFromV02(null, null, SEQUENTIAL_RANDOM);
    expect(configs.sources).toHaveLength(1);
  });
});

describe("migrateFromV03 (DS-204)", () => {
  const v3Source = {
    sourceId: "0123456789abcdef0123456789abcdef",
    displayName: "Team",
    captionTag: "TEAM",
    labelStyle: "brackets" as const,
    captionAlignment: "center" as const,
    color: "#7dd3fc",
    captureTarget: { kind: "endpoint" as const, endpointId: "cable-output" },
    monitoring: { enabled: true, headphoneEndpointId: "hp", volume: 1 },
    languageProfile: "mandarin" as const,
    strictness: "balanced" as const,
  };

  it("migrates v3 sources to v4 preserving every field", () => {
    const migrated = migrateFromV03({
      schemaVersion: 3 as const,
      sources: [v3Source],
    });
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.sources[0]).toMatchObject({
      sourceId: v3Source.sourceId,
      displayName: "Team",
      captionTag: "TEAM",
      labelStyle: "brackets",
      color: "#7dd3fc",
      captureTarget: { kind: "endpoint", endpointId: "cable-output" },
      monitoring: { enabled: true, headphoneEndpointId: "hp", volume: 1 },
      languageProfile: "mandarin",
      strictness: "balanced",
    });
    expect(migrated.sources[0]?.sourceOrigin).toBe("virtual_voice_channel");
    expect(migrated.sources[0]?.languageConfig).toEqual({
      primaryLanguage: "zh",
      secondaryLanguages: [],
      detectionMode: "fixed",
    });
  });

  it("derives full_auto for unknown profiles (never Filipino)", () => {
    const migrated = migrateFromV03({
      schemaVersion: 3 as const,
      sources: [{ ...v3Source, languageProfile: "auto" as const }],
    });
    expect(migrated.sources[0]?.languageConfig.detectionMode).toBe("full_auto");
    expect(migrated.sources[0]?.languageConfig.primaryLanguage).toBeNull();
  });

  it("is idempotent: v4 documents pass through untouched", () => {
    const v4 = migrateFromV03({
      schemaVersion: 3 as const,
      sources: [v3Source],
    });
    const again = migrateFromV03(v4);
    expect(again).toEqual(v4);
  });
});
