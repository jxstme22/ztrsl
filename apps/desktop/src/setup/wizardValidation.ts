import type { AudioEndpoint } from "../audio/model";
import type { VirtualCableDetection } from "./vbCable";
import type { WizardState } from "./wizardState";

/**
 * DS-505: wizard selection validation. Invalid combinations cannot be saved
 * without an explicit advanced override.
 */

export type SelectionProblem =
  | { code: "capture_missing"; message: string }
  | { code: "capture_inactive"; message: string }
  | { code: "monitor_missing"; message: string }
  | { code: "monitor_inactive"; message: string }
  | { code: "same_endpoint"; message: string }
  | { code: "monitor_on_cable"; message: string };

export type SelectionValidation = {
  problems: SelectionProblem[];
  valid: boolean;
};

function endpointOf(
  endpoints: AudioEndpoint[],
  endpointId: string | null,
): AudioEndpoint | null {
  return endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
}

export function validateWizardSelection(
  state: WizardState,
  endpoints: AudioEndpoint[],
  detection: VirtualCableDetection,
): SelectionValidation {
  const problems: SelectionProblem[] = [];

  const capture = endpointOf(endpoints, state.captureEndpointId);
  if (state.captureEndpointId === null || capture === null) {
    problems.push({
      code: "capture_missing",
      message: "Pick a capture source first.",
    });
  } else if (capture.state !== "active") {
    problems.push({
      code: "capture_inactive",
      message: "The capture device is not active.",
    });
  }

  if (state.monitoringEnabled) {
    const monitor = endpointOf(endpoints, state.monitorEndpointId);
    if (state.monitorEndpointId === null || monitor === null) {
      problems.push({
        code: "monitor_missing",
        message: "Pick a monitoring output, or turn monitoring off.",
      });
    } else if (monitor.state !== "active") {
      problems.push({
        code: "monitor_inactive",
        message: "The monitoring device is not active.",
      });
    } else {
      if (state.captureEndpointId === state.monitorEndpointId) {
        problems.push({
          code: "same_endpoint",
          message: "Capture and monitoring must be different devices.",
        });
      }
      // Feeding the cable's own capture back into a cable playback device
      // would loop; the monitoring destination must not be the cable.
      const isCablePlayback = detection.playbackCandidates.some(
        (candidate) => candidate.id === monitor.id,
      );
      if (isCablePlayback) {
        problems.push({
          code: "monitor_on_cable",
          message: "Monitoring must not route back into the cable.",
        });
      }
    }
  }

  return { problems, valid: problems.length === 0 };
}
