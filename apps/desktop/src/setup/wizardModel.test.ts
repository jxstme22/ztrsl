import { describe, expect, it } from "vitest";

import type { AudioEndpoint, EndpointCatalog } from "../audio/model";
import { MAX_SOURCES } from "../sources/model";
import { detectVbCable } from "./vbCable";
import {
  addSource,
  assignCaptureTarget,
  canProceed,
  currentStepId,
  goToStep,
  initialWizardState,
  markSaved,
  removeSource,
  save,
  selectMode,
  setLanguage,
  setMonitoring,
  setMonitorEndpoint,
  updateSource,
  type WizardState,
} from "./wizardModel";

function endpoint(overrides: Partial<AudioEndpoint>): AudioEndpoint {
  return {
    id: "dev://x",
    friendlyName: "Device",
    kind: "capture",
    state: "active",
    defaultRoles: {
      console: false,
      multimedia: false,
      communications: false,
    },
    nativeFormat: null,
    isSynthetic: false,
    ...overrides,
  };
}

const CABLE_INPUT = endpoint({
  id: "dev://cable-input",
  friendlyName: "CABLE Input (VB-Audio Virtual Cable)",
  kind: "render",
});
const CABLE_OUTPUT = endpoint({
  id: "dev://cable-output",
  friendlyName: "CABLE Output (VB-Audio Virtual Cable)",
  kind: "capture",
});
const HEADPHONES = endpoint({
  id: "dev://headphones",
  friendlyName: "Headphones",
  kind: "render",
});

function catalog(endpoints: AudioEndpoint[]): EndpointCatalog {
  return {
    platform: "windows",
    deviceChangeDetected: false,
    processCaptureSupported: false,
    endpoints,
  };
}

function withCable(): WizardState {
  const cat = catalog([CABLE_INPUT, CABLE_OUTPUT, HEADPHONES]);
  return initialWizardState(cat, detectVbCable(cat));
}

function recommendedComplete(state: WizardState): WizardState {
  let next = selectMode(state, "recommended");
  next = assignCaptureTarget(next, 0, { kind: "endpoint", endpointId: CABLE_INPUT.id });
  next = assignCaptureTarget(next, 1, { kind: "endpoint", endpointId: CABLE_INPUT.id });
  return next;
}

describe("wizard state machine", () => {
  it("starts on choose-setup with no mode and no sources", () => {
    const state = withCable();
    expect(currentStepId(state)).toBe("choose-setup");
    expect(state.mode).toBeNull();
    expect(state.sources).toEqual([]);
    expect(canProceed(state).ok).toBe(false);
  });

  it("recommended mode prefills TEAM and DISCORD drafts with fresh ids", () => {
    const state = selectMode(withCable(), "recommended");
    expect(state.mode).toBe("recommended");
    expect(state.sources).toHaveLength(2);
    expect(state.sources[0]?.config.captionTag).toBe("TEAM");
    expect(state.sources[1]?.config.captionTag).toBe("DISCORD");
    expect(state.sources[0]?.config.sourceId).not.toBe(state.sources[1]?.config.sourceId);
    expect(state.sources.every((draft) => !draft.captureResolved)).toBe(true);
  });

  it("advanced mode starts blank and respects the source cap", () => {
    let state = selectMode(withCable(), "advanced");
    expect(state.sources).toHaveLength(0);
    for (let i = 0; i < MAX_SOURCES; i += 1) {
      state = addSource(state, "custom");
    }
    expect(state.sources).toHaveLength(MAX_SOURCES);
    state = addSource(state, "custom");
    expect(state.sources).toHaveLength(MAX_SOURCES);
  });

  it("select-capture only passes when every source is explicitly resolved", () => {
    let state = selectMode(withCable(), "recommended");
    state = goToStep(state, 2);
    expect(canProceed(state).ok).toBe(false);
    state = assignCaptureTarget(state, 0, { kind: "endpoint", endpointId: CABLE_INPUT.id });
    expect(canProceed(state).ok).toBe(false);
    state = assignCaptureTarget(state, 1, { kind: "endpoint", endpointId: CABLE_INPUT.id });
    expect(canProceed(state).ok).toBe(true);
  });

  it("never auto-selects: an empty endpoint assignment stays unresolved", () => {
    let state = selectMode(withCable(), "recommended");
    state = assignCaptureTarget(state, 0, { kind: "endpoint", endpointId: null });
    expect(state.sources[0]?.captureResolved).toBe(false);
    state = assignCaptureTarget(state, 0, { kind: "process", processName: "" });
    expect(state.sources[0]?.captureResolved).toBe(false);
  });

  it("valorant-routing gate demands VB-CABLE in recommended mode only", () => {
    const noCable = initialWizardState(
      catalog([HEADPHONES]),
      detectVbCable(catalog([HEADPHONES])),
    );
    const state = goToStep(selectMode(noCable, "recommended"), 3);
    expect(canProceed(state).ok).toBe(false);
    expect(canProceed(state).reason).toContain("vb-audio.com");

    const advanced = goToStep(selectMode(noCable, "advanced"), 3);
    expect(canProceed(advanced).ok).toBe(true);

    const withCableState = goToStep(selectMode(withCable(), "recommended"), 3);
    expect(canProceed(withCableState).ok).toBe(true);
  });

  it("monitoring-output gate blocks capture==monitor feedback loops", () => {
    let state = recommendedComplete(withCable());
    state = assignCaptureTarget(state, 0, { kind: "endpoint", endpointId: CABLE_INPUT.id });
    state = setMonitoring(state, 0, {
      enabled: true,
      headphoneEndpointId: CABLE_INPUT.id,
    });
    expect(state.sources[0]?.monitorConflict).toBe(true);
    state = goToStep(state, 5);
    expect(canProceed(state).ok).toBe(false);
    expect(canProceed(state).reason).toContain("loops audio");

    state = setMonitoring(state, 0, {
      enabled: true,
      headphoneEndpointId: HEADPHONES.id,
    });
    expect(canProceed(state).ok).toBe(true);
  });

  it("edits name/tag/style and language settings without touching the id", () => {
    let state = selectMode(withCable(), "recommended");
    const id = state.sources[0]?.config.sourceId;
    state = updateSource(state, 0, { displayName: "Reno Squad", captionTag: "RENO" });
    state = setLanguage(state, 0, "cebuano", "strict");
    expect(state.sources[0]?.config.displayName).toBe("Reno Squad");
    expect(state.sources[0]?.config.captionTag).toBe("RENO");
    expect(state.sources[0]?.config.languageProfile).toBe("cebuano");
    expect(state.sources[0]?.config.strictness).toBe("strict");
    expect(state.sources[0]?.config.sourceId).toBe(id);
  });

  it("removeSource and out-of-range edits are safe no-ops", () => {
    let state = selectMode(withCable(), "recommended");
    state = removeSource(state, 1);
    expect(state.sources).toHaveLength(1);
    state = removeSource(state, 5);
    state = updateSource(state, 5, { displayName: "nope" });
    state = assignCaptureTarget(state, 5, { kind: "endpoint", endpointId: "x" });
    state = setMonitoring(state, 5, { enabled: true, headphoneEndpointId: null });
    state = setLanguage(state, 5, "auto", "off");
    expect(state.sources).toHaveLength(1);
  });

  it("save produces valid schema-v3 configs and markSaved flips the flag", () => {
    let state = recommendedComplete(withCable());
    state = setMonitoring(state, 0, { enabled: true, headphoneEndpointId: HEADPHONES.id });
    const { configs, error } = save(state);
    expect(error).toBeNull();
    expect(configs.schemaVersion).toBe(3);
    expect(configs.sources).toHaveLength(2);
    expect(state.sources[0]?.config.sourceId).toBe(configs.sources[0]?.sourceId);
    expect(markSaved(state).saved).toBe(true);
  });

  it("save reports an error when a draft is invalid", () => {
    let state = selectMode(withCable(), "recommended");
    state = updateSource(state, 0, { captionTag: "" });
    const { error } = save(state);
    expect(error).not.toBeNull();
  });

  it("setMonitorEndpoint stores the blend output", () => {
    const state = setMonitorEndpoint(withCable(), HEADPHONES.id);
    expect(state.monitorEndpointId).toBe(HEADPHONES.id);
  });
});
