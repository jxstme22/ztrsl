import type { AudioEndpoint, EndpointCatalog } from "../audio/model";

/**
 * VB-CABLE detection (Phase 4). VB-CABLE is a separately installed virtual
 * audio driver from its official source (vb-audio.com); this app never
 * bundles it (ADR-014). Detection is purely name-based over the ordinary
 * endpoint catalog — no driver access, no game interaction.
 *
 * VB-CABLE installs one "CABLE Input" capture endpoint and one "CABLE
 * Output" render endpoint. We treat it as installed only when both are
 * present, because a half-installed driver cannot route game voice into the
 * app.
 */

export type VbCableDetection = {
  installed: boolean;
  /** The capture endpoint named like "CABLE Input", or null. */
  input: AudioEndpoint | null;
  /** The render endpoint named like "CABLE Output", or null. */
  output: AudioEndpoint | null;
  /**
   * True when a matching endpoint exists but is not usable (disabled,
   * unplugged, or not present). The wizard must surface this instead of
   * silently proceeding.
   */
  degraded: boolean;
  /** Human-readable guidance for the wizard, in order of relevance. */
  issues: string[];
};

const INPUT_NAME = /cable\s+input/i;
const OUTPUT_NAME = /cable\s+output/i;

export function isUsableState(endpoint: AudioEndpoint): boolean {
  return endpoint.state === "active";
}

export function detectVbCable(catalog: EndpointCatalog): VbCableDetection {
  const input =
    catalog.endpoints.find(
      (endpoint) => endpoint.kind === "capture" && INPUT_NAME.test(endpoint.friendlyName),
    ) ?? null;
  const output =
    catalog.endpoints.find(
      (endpoint) => endpoint.kind === "render" && OUTPUT_NAME.test(endpoint.friendlyName),
    ) ?? null;

  const issues: string[] = [];
  if (input !== null && output !== null && isUsableState(input) && isUsableState(output)) {
    return { installed: true, input, output, degraded: false, issues };
  }
  if (input === null || output === null) {
    issues.push(
      "VB-CABLE was not found. Install it separately from its official source " +
        "(vb-audio.com) and restart the app.",
    );
  }
  if (input !== null && !isUsableState(input)) {
    issues.push(`"${input.friendlyName}" is not active (state: ${input.state}). Enable the driver in Windows sound settings.`);
  }
  if (output !== null && !isUsableState(output)) {
    issues.push(`"${output.friendlyName}" is not active (state: ${output.state}). Enable the driver in Windows sound settings.`);
  }
  return { installed: false, input, output, degraded: true, issues };
}
