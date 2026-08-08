import { describe, expect, it } from "vitest";

import type { AudioEndpoint } from "../audio/model";
import {
  deleteRoutingProfile,
  loadRoutingProfiles,
  profileFromWizard,
  recoverProfile,
  replaceProfileEndpoint,
  resetProfile,
  saveRoutingProfiles,
} from "./routingProfiles";
import {
  initialWizardState,
  type WizardState,
} from "./wizardState";
import { DOMAIN_PRESET_CATALOG, getDomainPreset } from "../presets/catalog";
import {
  resolveEffectiveConfig,
  resolveExplain,
} from "../presets/resolver";
import { defaultSourceConfig } from "../sources/model";
import { createSourceFromPreset } from "../sources/presets";

const ENDPOINTS: AudioEndpoint[] = [
  { id: "cable-out", friendlyName: "CABLE Output", kind: "capture", state: "active" },
  { id: "hp", friendlyName: "Headphones", kind: "render", state: "active" },
] as AudioEndpoint[];

function wizard(): WizardState {
  return {
    ...initialWizardState(),
    useCaseId: "valorant",
    captureEndpointId: "cable-out",
    monitorEndpointId: "hp",
    monitoringEnabled: true,
    signalResult: "healthy",
    isolationResult: "passed",
  };
}

describe("routing profiles (DS-508)", () => {
  it("builds a profile from the wizard state", () => {
    const profile = profileFromWizard(wizard(), "Valorant Team", {
      id: "p1",
      sourceOrigin: "virtual_voice_channel",
      domainPresetId: "valorant",
      qualityProfileId: "balanced",
      vadProfileId: "fast_callouts",
    });
    expect(profile.captureEndpointId).toBe("cable-out");
    expect(profile.monitorEndpointId).toBe("hp");
    expect(profile.monitoringEnabled).toBe(true);
    expect(profile.signalResult).toBe("healthy");
    expect(profile.isolationResult).toBe("passed");
  });

  it("saves and loads profiles without losing fields", () => {
    const storage = new Map<string, string>();
    const get = { getItem: (k: string) => storage.get(k) ?? null };
    const set = { setItem: (k: string, v: string) => storage.set(k, v) };
    const profile = profileFromWizard(wizard(), "Team", {
      id: "p2",
      sourceOrigin: "virtual_voice_channel",
      domainPresetId: "valorant",
      qualityProfileId: "balanced",
      vadProfileId: "fast_callouts",
    });
    saveRoutingProfiles([profile], set);
    const loaded = loadRoutingProfiles(get);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(profile);
  });

  it("deletes only the requested profile", () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    };
    saveRoutingProfiles(
      [
        profileFromWizard(wizard(), "A", { id: "a", sourceOrigin: "virtual_voice_channel", domainPresetId: "general", qualityProfileId: "balanced", vadProfileId: "natural_conversation" }),
        profileFromWizard(wizard(), "B", { id: "b", sourceOrigin: "virtual_voice_channel", domainPresetId: "general", qualityProfileId: "balanced", vadProfileId: "natural_conversation" }),
      ],
      store,
    );
    expect(deleteRoutingProfile("a", store).map((p) => p.id)).toEqual(["b"]);
  });

  it("recovers from missing endpoints instead of deleting", () => {
    const profile = profileFromWizard(wizard(), "Team", {
      id: "p3",
      sourceOrigin: "virtual_voice_channel",
      domainPresetId: "valorant",
      qualityProfileId: "balanced",
      vadProfileId: "fast_callouts",
    });
    const recovery = recoverProfile(profile, ENDPOINTS.filter((e) => e.id === "hp"));
    expect(recovery.usable).toBe(false);
    expect(recovery.missing).toContain("cable-out");
    expect(recovery.profile.id).toBe("p3");
  });

  it("replaces an endpoint without recreating the profile", () => {
    const profile = profileFromWizard(wizard(), "Team", {
      id: "p4",
      sourceOrigin: "virtual_voice_channel",
      domainPresetId: "valorant",
      qualityProfileId: "balanced",
      vadProfileId: "fast_callouts",
    });
    const replaced = replaceProfileEndpoint(profile, "cable-out", "cable-out-2");
    expect(replaced.captureEndpointId).toBe("cable-out-2");
    expect(replaced.monitorEndpointId).toBe("hp");
    expect(replaced.name).toBe("Team");
  });

  it("resets only this profile, keeping its identity", () => {
    const profile = profileFromWizard(wizard(), "Team", {
      id: "p5",
      sourceOrigin: "virtual_voice_channel",
      domainPresetId: "valorant",
      qualityProfileId: "balanced",
      vadProfileId: "fast_callouts",
    });
    const reset = resetProfile(profile);
    expect(reset.captureEndpointId).toBeNull();
    expect(reset.monitoringEnabled).toBe(false);
    expect(reset.id).toBe("p5");
    expect(reset.name).toBe("Team");
  });
});

describe("preset resolver (DS-600)", () => {
  it("applies the global default with no inputs", () => {
    const effective = resolveEffectiveConfig({});
    expect(effective.domainPresetId).toBe("general");
    expect(effective.qualityProfileId).toBe("balanced");
    expect(effective.sourceOrigin).toBe("virtual_voice_channel");
  });

  it("domain preset wins over the global default", () => {
    const effective = resolveEffectiveConfig({
      sourceOverride: { domainPresetId: "meeting" },
    });
    expect(effective.vadProfileId).toBe("meeting");
    expect(effective.glossaryPackId).toBe("business_meeting");
  });

  it("explicit user overrides win over saved source overrides", () => {
    const effective = resolveEffectiveConfig({
      sourceOverride: { domainPresetId: "meeting", qualityProfileId: "best_quality" },
      userOverrides: { domainPresetId: "valorant", qualityProfileId: "fast" },
    });
    expect(effective.domainPresetId).toBe("valorant");
    expect(effective.qualityProfileId).toBe("fast");
    expect(effective.vadProfileId).toBe("fast_callouts");
  });

  it("source origin contributes its policy defaults", () => {
    const effective = resolveEffectiveConfig({
      sourceOverride: { sourceOrigin: "physical_microphone" },
    });
    expect(effective.normalize).toBe(true);
  });

  it("explains the chosen route for diagnostics", () => {
    const { reasons } = resolveExplain({
      userOverrides: { domainPresetId: "discord" },
    });
    expect(reasons.some((reason) => reason.includes("explicit user override"))).toBe(true);
  });
});

describe("presets carry no hidden provider or game assumptions (DS-601/602/603/606)", () => {
  it("general preset contains no game-specific vocabulary", () => {
    const general = getDomainPreset("general");
    expect(general?.glossaryPackId).toBeNull();
    expect(general?.hotwordPackId).toBeNull();
    expect(general?.displayName).not.toMatch(/valorant|game/i);
  });

  it("no preset embeds a provider id", () => {
    for (const preset of DOMAIN_PRESET_CATALOG.presets) {
      const serialized = JSON.stringify(preset);
      expect(serialized).not.toMatch(/whisper|nllb|madlad|opus-mt|groq|nvidia/);
    }
  });

  it("every preset references a VAD profile that exists", () => {
    const known = ["fast_callouts", "natural_conversation", "meeting"];
    for (const preset of DOMAIN_PRESET_CATALOG.presets) {
      expect(known).toContain(preset.vadProfileId);
    }
  });

  it("the VALORANT workflow is preserved via the preset builder", () => {
    const fromPreset = createSourceFromPreset("valorant-team");
    const legacy = defaultSourceConfig();
    expect(fromPreset.displayName).toBe(legacy.displayName);
    expect(fromPreset.captionTag).toBe(legacy.captionTag);
  });
});
