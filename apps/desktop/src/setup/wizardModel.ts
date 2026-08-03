import {
  MAX_SOURCES,
  sourceConfigsSchema,
  type AudioSourceConfig,
  type CaptureTarget,
  type LanguageProfile,
  type LanguageStrictness,
  type MonitoringConfig,
  type SourceConfigs,
} from "../sources/model";
import {
  createSourceFromPreset,
  type SourcePresetId,
} from "../sources/presets";
import type { EndpointCatalog } from "../audio/model";
import type { VbCableDetection } from "./vbCable";

/**
 * Phase 4 routing wizard model (spec §10, steps 1–11). Pure state machine
 * over immutable transitions so every gate and save path is unit-testable
 * with fake endpoint catalogs.
 *
 * Drafts are full `AudioSourceConfig`s built from presets (fresh immutable
 * ids); the wizard never mutates an id. The saved payload is the schema-v3
 * `SourceConfigs` — the same shape `SourcesPanel` persists.
 */

export const WIZARD_STEP_IDS = [
  "choose-setup",
  "add-first-source",
  "select-capture",
  "valorant-routing",
  "add-social",
  "monitoring-output",
  "isolation-test",
  "monitoring-test",
  "language-strictness",
  "overlay-preview",
  "save-preset",
] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export const WIZARD_STEP_LABELS: Record<WizardStepId, string> = {
  "choose-setup": "Setup type",
  "add-first-source": "Add the first source",
  "select-capture": "Capture method",
  "valorant-routing": "Valorant routing",
  "add-social": "Social source",
  "monitoring-output": "Monitoring output",
  "isolation-test": "Source isolation test",
  "monitoring-test": "Monitoring test",
  "language-strictness": "Language & strictness",
  "overlay-preview": "Overlay preview",
  "save-preset": "Save preset",
};

export type SetupMode = "recommended" | "advanced";

export type WizardDraftSource = {
  /** Always a full, preset-derived config with an immutable sourceId. */
  config: AudioSourceConfig;
  presetId: SourcePresetId;
  /** True once the user explicitly assigned a capture method (never auto). */
  captureResolved: boolean;
  /** True when monitoring points at the same endpoint as capture. */
  monitorConflict: boolean;
};

export type WizardState = {
  mode: SetupMode | null;
  stepIndex: number;
  sources: WizardDraftSource[];
  catalog: EndpointCatalog;
  vbCable: VbCableDetection;
  /** Endpoint chosen for the headphone monitoring blend. */
  monitorEndpointId: string | null;
  saved: boolean;
};

const VALORANT_TEAM_PRESET: SourcePresetId = "valorant-team";
const DISCORD_PRESET: SourcePresetId = "discord";

export function initialWizardState(
  catalog: EndpointCatalog,
  vbCable: VbCableDetection,
): WizardState {
  return {
    mode: null,
    stepIndex: 0,
    sources: [],
    catalog,
    vbCable,
    monitorEndpointId: null,
    saved: false,
  };
}

export function currentStepId(state: WizardState): WizardStepId {
  const clamped = Math.min(state.stepIndex, WIZARD_STEP_IDS.length - 1);
  return WIZARD_STEP_IDS[clamped] ?? "choose-setup";
}

export function selectMode(state: WizardState, mode: SetupMode): WizardState {
  if (state.mode === mode) {
    return state;
  }
  // Recommended: VALORANT Team + Discord as editable starting points.
  // Advanced: start blank. Nothing is auto-assigned a capture target.
  const sources =
    mode === "recommended"
      ? [draftFromPreset(VALORANT_TEAM_PRESET), draftFromPreset(DISCORD_PRESET)]
      : [];
  const firstSourceStep = WIZARD_STEP_IDS.indexOf("add-first-source");
  return { ...state, mode, sources, stepIndex: firstSourceStep };
}

function draftFromPreset(presetId: SourcePresetId): WizardDraftSource {
  return {
    config: createSourceFromPreset(presetId),
    presetId,
    captureResolved: false,
    monitorConflict: false,
  };
}

export function addSource(
  state: WizardState,
  presetId: SourcePresetId,
): WizardState {
  if (state.sources.length >= MAX_SOURCES) {
    return state;
  }
  return { ...state, sources: [...state.sources, draftFromPreset(presetId)] };
}

export function removeSource(state: WizardState, index: number): WizardState {
  if (index < 0 || index >= state.sources.length) {
    return state;
  }
  const sources = state.sources.filter((_, i) => i !== index);
  return { ...state, sources };
}

export function updateSource(
  state: WizardState,
  index: number,
  patch: Partial<
    Pick<AudioSourceConfig, "displayName" | "captionTag" | "labelStyle">
  >,
): WizardState {
  if (index < 0 || index >= state.sources.length) {
    return state;
  }
  const sources = state.sources.map((draft, i) =>
    i === index ? { ...draft, config: { ...draft.config, ...patch } } : draft,
  );
  return { ...state, sources };
}

/** Explicit assignment only — the wizard never silently selects a target. */
export function assignCaptureTarget(
  state: WizardState,
  index: number,
  target: CaptureTarget,
): WizardState {
  if (index < 0 || index >= state.sources.length) {
    return state;
  }
  const sources = state.sources.map((draft, i) => {
    if (i !== index) {
      return draft;
    }
    const resolved =
      (target.kind === "endpoint" &&
        target.endpointId !== null &&
        target.endpointId.length > 0) ||
      (target.kind === "process" && target.processName.length > 0);
    return {
      ...draft,
      config: { ...draft.config, captureTarget: target },
      captureResolved: resolved,
    };
  });
  return { ...state, sources };
}

export function setMonitoring(
  state: WizardState,
  index: number,
  patch: Partial<Omit<MonitoringConfig, "volume">>,
): WizardState {
  if (index < 0 || index >= state.sources.length) {
    return state;
  }
  const sources = state.sources.map((draft, i) => {
    if (i !== index) {
      return draft;
    }
    const monitoring: MonitoringConfig = {
      ...draft.config.monitoring,
      ...patch,
    };
    const target = draft.config.captureTarget;
    const monitorConflict =
      monitoring.enabled &&
      monitoring.headphoneEndpointId !== null &&
      target.kind === "endpoint" &&
      target.endpointId === monitoring.headphoneEndpointId;
    return {
      ...draft,
      config: { ...draft.config, monitoring },
      monitorConflict,
    };
  });
  return { ...state, sources };
}

/** Per-source blend gain (spec §10 step 8). Never touches ASR paths. */
export function setMonitorVolume(
  state: WizardState,
  index: number,
  volume: number,
): WizardState {
  if (
    index < 0 ||
    index >= state.sources.length ||
    !(0 <= volume && volume <= 1)
  ) {
    return state;
  }
  const sources = state.sources.map((draft, i) =>
    i === index
      ? {
          ...draft,
          config: {
            ...draft.config,
            monitoring: { ...draft.config.monitoring, volume },
          },
        }
      : draft,
  );
  return { ...state, sources };
}

export function setMonitorEndpoint(
  state: WizardState,
  monitorEndpointId: string | null,
): WizardState {
  return { ...state, monitorEndpointId };
}

export function setLanguage(
  state: WizardState,
  index: number,
  profile: LanguageProfile,
  strictness: LanguageStrictness,
): WizardState {
  if (index < 0 || index >= state.sources.length) {
    return state;
  }
  const sources = state.sources.map((draft, i) =>
    i === index
      ? {
          ...draft,
          config: { ...draft.config, languageProfile: profile, strictness },
        }
      : draft,
  );
  return { ...state, sources };
}

export function goToStep(state: WizardState, stepIndex: number): WizardState {
  const clamped = Math.max(0, Math.min(stepIndex, WIZARD_STEP_IDS.length - 1));
  return { ...state, stepIndex: clamped };
}

export type StepGate = {
  ok: boolean;
  reason: string | null;
};

/**
 * Per-step proceed gates (spec §10). Steps without a listed rule are
 * guidance-only and always pass.
 */
export function canProceed(state: WizardState): StepGate {
  switch (currentStepId(state)) {
    case "choose-setup":
      return state.mode === null
        ? { ok: false, reason: "Choose a setup type." }
        : { ok: true, reason: null };
    case "add-first-source":
      return state.sources.length === 0
        ? { ok: false, reason: "Add at least one source." }
        : { ok: true, reason: null };
    case "select-capture":
      return {
        ok:
          state.sources.length > 0 &&
          state.sources.every((draft) => draft.captureResolved),
        reason:
          state.sources.length > 0 &&
          state.sources.every((draft) => draft.captureResolved)
            ? null
            : "Assign a capture method to every source. Nothing is selected automatically.",
      };
    case "valorant-routing":
      if (state.mode !== "recommended") {
        return { ok: true, reason: null };
      }
      return state.vbCable.installed
        ? { ok: true, reason: null }
        : {
            ok: false,
            reason:
              "Recommended setup routes VALORANT voice chat through VB-CABLE. " +
              "Install it separately from its official source (vb-audio.com), " +
              "then refresh this page.",
          };
    case "add-social":
      return state.sources.length < 2
        ? { ok: false, reason: "Add at least one social source." }
        : { ok: true, reason: null };
    case "monitoring-output":
      return {
        ok: state.sources.every((draft) => !draft.monitorConflict),
        reason: state.sources.some((draft) => draft.monitorConflict)
          ? "A source captures and monitors the same endpoint — that loops audio. Pick different endpoints."
          : null,
      };
    case "language-strictness":
      return { ok: true, reason: null };
    default:
      return { ok: true, reason: null };
  }
}

export function save(state: WizardState): {
  configs: SourceConfigs;
  error: string | null;
} {
  const result = sourceConfigsSchema.safeParse({
    schemaVersion: 3,
    sources: state.sources.map((draft) => draft.config),
  });
  if (!result.success) {
    return {
      configs: { schemaVersion: 3, sources: [] },
      error: "Cannot save: some source settings are invalid.",
    };
  }
  return { configs: result.data, error: null };
}

export function markSaved(state: WizardState): WizardState {
  return { ...state, saved: true };
}
