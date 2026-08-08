import { describe, expect, it } from "vitest";

import {
  DOMAIN_PRESET_CATALOG,
  domainPresetCatalogIsValid,
  getDomainPreset,
} from "./catalog";
import {
  DEFAULT_QUALITY_PROFILE_ID,
  QUALITY_PROFILES,
  loadQualityProfileId,
  saveQualityProfileId,
  type QualityProfileId,
} from "./quality";

describe("domain preset catalog (DS-202)", () => {
  it("validates the embedded catalog", () => {
    expect(domainPresetCatalogIsValid()).toBe(true);
  });

  it("has unique ids covering the required presets", () => {
    const ids = DOMAIN_PRESET_CATALOG.presets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      "general",
      "valorant",
      "gaming",
      "discord",
      "meeting",
      "streaming",
      "language_learning",
      "accessibility",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("references non-empty profile/policy ids", () => {
    for (const preset of DOMAIN_PRESET_CATALOG.presets) {
      expect(preset.vadProfileId.length).toBeGreaterThan(0);
      expect(preset.captionProfileId.length).toBeGreaterThan(0);
      expect(preset.latencyProfileId.length).toBeGreaterThan(0);
    }
  });

  it("looks up presets by id", () => {
    expect(getDomainPreset("valorant")?.displayName).toBe("VALORANT");
    expect(getDomainPreset("nope")).toBeUndefined();
  });
});

describe("quality profiles (DS-203)", () => {
  it("provides all four profiles with sane policy fields", () => {
    for (const id of ["fast", "balanced", "best_quality", "low_memory"]) {
      const profile = QUALITY_PROFILES[id as QualityProfileId];
      expect(profile.id).toBe(id);
      expect(profile.maximumExpectedLatencyMs).toBeGreaterThan(0);
    }
  });

  it("defaults to balanced and persists the choice", () => {
    const storage = new Map<string, string>();
    const get = { getItem: (key: string) => storage.get(key) ?? null };
    const set = {
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    expect(loadQualityProfileId(get)).toBe(DEFAULT_QUALITY_PROFILE_ID);
    saveQualityProfileId("best_quality", set);
    expect(loadQualityProfileId(get)).toBe("best_quality");
  });

  it("falls back for unknown stored values", () => {
    const storage = new Map<string, string>([["lst.qualityProfile", "ultra"]]);
    expect(
      loadQualityProfileId({
        getItem: (key: string) => storage.get(key) ?? null,
      }),
    ).toBe(DEFAULT_QUALITY_PROFILE_ID);
  });
});
