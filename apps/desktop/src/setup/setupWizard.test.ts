import { describe, expect, it } from "vitest";

import { ROUTING_STEPS, USE_CASES } from "./useCases";
import {
  initialWizardState,
  wizardReducer,
  type WizardState,
} from "./wizardState";
import {
  classifySignalLevel,
  decideIsolationResult,
} from "./signalTest";
import {
  validateWizardSelection,
  type SelectionValidation,
} from "./wizardValidation";
import type { AudioEndpoint } from "../audio/model";

const ENDPOINTS: AudioEndpoint[] = [
  { id: "cable-out", friendlyName: "CABLE Output", kind: "capture", state: "active" },
  { id: "hp", friendlyName: "Headphones", kind: "render", state: "active" },
  { id: "cable-in", friendlyName: "CABLE Input", kind: "render", state: "active" },
] as AudioEndpoint[];

const DETECTION = {
  playbackCandidates: [ENDPOINTS[2]],
  recordingCandidates: [ENDPOINTS[0]],
  confidence: "high",
  warnings: [],
} as unknown as ReturnType<typeof import("./vbCable").detectVirtualCables>;

describe("wizard state machine (DS-501)", () => {
  it("walks forward through every step", () => {
    let state: WizardState = wizardReducer(initialWizardState(), {
      type: "select_use_case",
      useCaseId: "valorant",
    });
    for (const action of [
      { type: "next" as const },
      { type: "next" as const },
      { type: "select_capture" as const, endpointId: "cable-out" },
      { type: "next" as const },
      { type: "toggle_monitoring" as const, enabled: true },
      { type: "select_monitor" as const, endpointId: "hp" },
      { type: "next" as const },
      { type: "signal_result" as const, result: "healthy" as const },
      { type: "next" as const },
      { type: "isolation_result" as const, result: "passed" as const },
      { type: "next" as const },
      { type: "save" as const },
    ]) {
      state = wizardReducer(state, action);
    }
    expect(state.step).toBe("saved");
    expect(state.saved).toBe(true);
  });

  it("never advances without a use case", () => {
    expect(wizardReducer(initialWizardState(), { type: "next" }).step).toBe(
      "choose_use_case",
    );
  });

  it("never advances past select_capture without a capture", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "select_capture",
      useCaseId: "valorant",
    };
    expect(wizardReducer(state, { type: "next" }).step).toBe("select_capture");
  });

  it("back keeps valid choices", () => {
    let state = wizardReducer(
      { ...initialWizardState(), step: "test_signal", useCaseId: "valorant" },
      { type: "back" },
    );
    expect(state.step).toBe("select_monitor");
    expect(state.useCaseId).toBe("valorant");
    state = wizardReducer(state, { type: "back" });
    expect(state.step).toBe("select_capture");
  });

  it("refresh keeps the use case and goes back to detection", () => {
    const state = wizardReducer(
      { ...initialWizardState(), step: "select_capture", useCaseId: "discord" },
      { type: "refresh_devices" },
    );
    expect(state.step).toBe("detect_cable");
    expect(state.useCaseId).toBe("discord");
  });

  it("cancel resets everything without saving", () => {
    const state = wizardReducer(
      { ...initialWizardState(), step: "review", useCaseId: "valorant", saved: false },
      { type: "cancel" },
    );
    expect(state).toEqual(initialWizardState());
  });

  it("save is atomic and saved is final", () => {
    const review: WizardState = {
      step: "review",
      useCaseId: "valorant",
      captureEndpointId: "cable-out",
      monitorEndpointId: "hp",
      monitoringEnabled: true,
      signalResult: "healthy",
      isolationResult: "passed",
      saved: false,
    };
    const saved = wizardReducer(review, { type: "save" });
    expect(saved.step).toBe("saved");
    expect(wizardReducer(saved, { type: "back" }).step).toBe("saved");
  });
});

describe("use cases + routing (DS-502/DS-504)", () => {
  it("suggests per-use-case defaults without touching devices", () => {
    for (const useCase of Object.values(USE_CASES)) {
      expect(useCase.suggestedPresetId.length).toBeGreaterThan(0);
      expect(useCase.suggestedSourceOrigin.length).toBeGreaterThan(0);
    }
    expect(USE_CASES.valorant.suggestedVadProfileId).toBe("fast_callouts");
    expect(USE_CASES.meeting.suggestedVadProfileId).toBe("meeting");
  });

  it("adapts routing instructions per use case", () => {
    expect(ROUTING_STEPS.valorant.some((s) => s.from.includes("Voice chat"))).toBe(true);
    expect(ROUTING_STEPS.browser_call.some((s) => s.from.includes("Browser"))).toBe(true);
    expect(ROUTING_STEPS.valorant.length).toBeGreaterThanOrEqual(4);
  });
});

describe("selection validation (DS-505)", () => {
  it("rejects a missing capture", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "select_monitor",
      captureEndpointId: null,
    };
    const result = validateWizardSelection(state, ENDPOINTS, DETECTION);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.code === "capture_missing")).toBe(true);
  });

  it("rejects monitoring onto the cable itself", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "select_monitor",
      captureEndpointId: "cable-out",
      monitoringEnabled: true,
      monitorEndpointId: "cable-in",
    };
    const result: SelectionValidation = validateWizardSelection(
      state,
      ENDPOINTS,
      DETECTION,
    );
    expect(result.problems.some((p) => p.code === "monitor_on_cable")).toBe(true);
  });

  it("accepts a valid capture + headphones monitoring", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "review",
      captureEndpointId: "cable-out",
      monitoringEnabled: true,
      monitorEndpointId: "hp",
    };
    expect(validateWizardSelection(state, ENDPOINTS, DETECTION).valid).toBe(true);
  });
});

describe("signal + isolation tests (DS-506/DS-507)", () => {
  it("classifies signal levels deterministically", () => {
    expect(classifySignalLevel({ rms: 0.1, peak: 0.3, clippingRatio: 0 })).toBe("healthy");
    expect(classifySignalLevel({ rms: 0.001, peak: 0.01, clippingRatio: 0 })).toBe("silent");
    expect(classifySignalLevel({ rms: 0.01, peak: 0.04, clippingRatio: 0 })).toBe("very_quiet");
    expect(classifySignalLevel({ rms: 0.1, peak: 0.99, clippingRatio: 0.05 })).toBe("clipping");
  });

  it("decides isolation results with honest wording", () => {
    expect(decideIsolationResult(0.05, 0.6)).toBe("passed");
    expect(decideIsolationResult(0.6, 0.6)).toBe("failed_non_voice_leak");
    expect(decideIsolationResult(0.05, 0.05)).toBe("failed_no_voice");
  });
});
