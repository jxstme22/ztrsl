/**
 * DS-501: setup-wizard state machine (pure reducer).
 *
 * Steps follow the guided flow; state survives accidental window
 * navigation because it lives in the reducer, not component state. Back
 * navigation never loses valid choices; every step validates only its own
 * requirements; cancel resets without modifying existing profiles; save is
 * one atomic transition.
 */

export type WizardStep =
  | "choose_use_case"
  | "detect_cable"
  | "show_routing"
  | "select_capture"
  | "select_monitor"
  | "test_signal"
  | "test_isolation"
  | "review"
  | "saved";

export type SignalLevel = "silent" | "very_quiet" | "healthy" | "clipping";
export type IsolationResult =
  | "passed"
  | "inconclusive"
  | "failed_non_voice_leak"
  | "failed_no_voice";

export type WizardState = {
  step: WizardStep;
  useCaseId: string | null;
  captureEndpointId: string | null;
  monitorEndpointId: string | null;
  monitoringEnabled: boolean;
  signalResult: SignalLevel | null;
  isolationResult: IsolationResult | null;
  saved: boolean;
};

export const WIZARD_STEPS: WizardStep[] = [
  "choose_use_case",
  "detect_cable",
  "show_routing",
  "select_capture",
  "select_monitor",
  "test_signal",
  "test_isolation",
  "review",
  "saved",
];

export function initialWizardState(): WizardState {
  return {
    step: "choose_use_case",
    useCaseId: null,
    captureEndpointId: null,
    monitorEndpointId: null,
    monitoringEnabled: false,
    signalResult: null,
    isolationResult: null,
    saved: false,
  };
}

export type WizardAction =
  | { type: "select_use_case"; useCaseId: string }
  | { type: "refresh_devices" }
  | { type: "select_capture"; endpointId: string }
  | { type: "select_monitor"; endpointId: string }
  | { type: "toggle_monitoring"; enabled: boolean }
  | { type: "signal_result"; result: SignalLevel }
  | { type: "isolation_result"; result: IsolationResult }
  | { type: "next" }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "save" };

function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** Each step validates only its own requirements before allowing Next. */
function canAdvance(state: WizardState): boolean {
  switch (state.step) {
    case "choose_use_case":
      return state.useCaseId !== null;
    case "detect_cable":
      // Continue even without a cable: the user may pick another source
      // type (handled by the component); the state machine allows Next.
      return true;
    case "show_routing":
      return true;
    case "select_capture":
      return state.captureEndpointId !== null;
    case "select_monitor":
      return !state.monitoringEnabled || state.monitorEndpointId !== null;
    case "test_signal":
      return state.signalResult !== null;
    case "test_isolation":
      return state.isolationResult !== null;
    case "review":
      return true;
    case "saved":
      return false;
  }
}

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "select_use_case":
      // Re-selecting a use case resets downstream choices that depend on it.
      return {
        ...initialWizardState(),
        step: "detect_cable",
        useCaseId: action.useCaseId,
      };
    case "refresh_devices":
      // Detection re-runs against the current catalog; the chosen use case
      // and any valid selections survive.
      return { ...state, step: "detect_cable" };
    case "select_capture":
      return { ...state, captureEndpointId: action.endpointId };
    case "select_monitor":
      return { ...state, monitorEndpointId: action.endpointId };
    case "toggle_monitoring":
      return {
        ...state,
        monitoringEnabled: action.enabled,
        monitorEndpointId: action.enabled ? state.monitorEndpointId : null,
      };
    case "signal_result":
      return { ...state, signalResult: action.result };
    case "isolation_result":
      return { ...state, isolationResult: action.result };
    case "next": {
      if (!canAdvance(state)) {
        return state;
      }
      const index = stepIndex(state.step);
      const nextStep = WIZARD_STEPS[index + 1];
      if (nextStep === undefined || index >= WIZARD_STEPS.length - 1) {
        return state;
      }
      return { ...state, step: nextStep };
    }
    case "back": {
      const index = stepIndex(state.step);
      if (index <= 0 || state.step === "saved") {
        return state;
      }
      // Back keeps every valid choice; saved is final.
      const previousStep = WIZARD_STEPS[index - 1];
      if (previousStep === undefined) {
        return state;
      }
      return { ...state, step: previousStep };
    }
    case "cancel":
      return initialWizardState();
    case "save": {
      if (!canAdvance({ ...state, step: "review" })) {
        return state;
      }
      return { ...state, step: "saved", saved: true };
    }
  }
}
