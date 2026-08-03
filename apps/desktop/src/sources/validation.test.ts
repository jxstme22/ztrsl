import { describe, expect, it } from "vitest";

import { createSourceFromPreset } from "./presets";
import {
  validateName,
  validateSource,
  validateSources,
  validateTag,
} from "./validation";
import type { AudioSourceConfig } from "./model";

function makeSource(
  overrides: Partial<AudioSourceConfig> = {},
): AudioSourceConfig {
  return {
    ...createSourceFromPreset("custom"),
    ...overrides,
  };
}

describe("validateName", () => {
  it("accepts a normal name", () => {
    expect(validateName("Valorant Team")).toBeNull();
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("   ")).not.toBeNull();
  });

  it("rejects over-long names", () => {
    expect(validateName("x".repeat(49))).not.toBeNull();
    expect(validateName("x".repeat(48))).toBeNull();
  });

  it("rejects control characters", () => {
    expect(validateName("Team\u0000Name")).not.toBeNull();
    expect(validateName("Team\nName")).not.toBeNull();
  });
});

describe("validateTag", () => {
  it("accepts a normal tag", () => {
    expect(validateTag("TEAM")).toBeNull();
    expect(validateTag("teám")).toBeNull();
  });

  it("rejects empty tags", () => {
    expect(validateTag("")).not.toBeNull();
  });

  it("rejects control characters", () => {
    expect(validateTag("T\u0007EAM")).not.toBeNull();
    expect(validateTag("T\nEAM")).not.toBeNull();
  });

  it("rejects tags over 32 characters", () => {
    expect(validateTag("x".repeat(33))).not.toBeNull();
    expect(validateTag("x".repeat(32))).toBeNull();
  });
});

describe("validateSource", () => {
  it("passes a default source", () => {
    const source = makeSource();
    const result = validateSource(source, [source]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("flags duplicate tags as a warning, not an error", () => {
    const team = makeSource({ captionTag: "TEAM" });
    const discord = makeSource({ captionTag: "discord" });
    const second = makeSource({ captionTag: "TEAM" });
    const result = validateSource(second, [team, discord, second]);
    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("also used by another source")),
    ).toBe(true);
  });

  it("does not flag a source against itself", () => {
    const source = makeSource({ captionTag: "TEAM" });
    expect(validateSource(source, [source]).warnings).toEqual([]);
  });

  it("warns on long tags", () => {
    const source = makeSource({ captionTag: "A-VERY-LONG-TAG-NAME" });
    expect(
      validateSource(source, [source]).warnings.some((w) => w.includes("wrap")),
    ).toBe(true);
  });

  it("rejects monitoring without a headphone endpoint", () => {
    const source = makeSource({
      monitoring: { enabled: true, headphoneEndpointId: null },
    });
    expect(validateSource(source, [source]).errors).toContain(
      "Monitoring is enabled but no headphone endpoint is selected.",
    );
  });

  it("accepts monitoring with a headphone endpoint", () => {
    const source = makeSource({
      monitoring: { enabled: true, headphoneEndpointId: "headset-output" },
    });
    expect(validateSource(source, [source]).errors).toEqual([]);
  });
});

describe("validateSources", () => {
  it("collects errors across sources", () => {
    const configs = {
      schemaVersion: 3 as const,
      sources: [
        makeSource({ displayName: "  " }),
        makeSource({ captionTag: "T\nEAM" }),
      ],
    };
    const result = validateSources(configs);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
