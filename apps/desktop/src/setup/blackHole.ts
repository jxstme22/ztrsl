import type { AudioEndpoint, EndpointCatalog } from "../audio/model";

/**
 * BlackHole detection (macOS). BlackHole is a separately installed virtual
 * audio driver from its official source (github.com/ExistentialAudio/BlackHole);
 * this app never bundles it. Detection is purely name-based over the ordinary
 * endpoint catalog — no driver access, no game interaction (same boundary as
 * VB-CABLE on Windows, ADR-014).
 *
 * BlackHole installs one virtual device that appears as both a CAPTURE
 * (recording) input — the side the app records FROM — and a RENDER (playback)
 * output — the side voice apps play INTO. The user routes VALORANT output to
 * BlackHole in the game's audio settings; the app then captures BlackHole's
 * input side.
 */

export type BlackHoleDetection = {
  installed: boolean;
  /** The capture endpoint (what the app records from), or null. */
  input: AudioEndpoint | null;
  /** The render endpoint (what apps play into), or null. */
  output: AudioEndpoint | null;
  degraded: boolean;
  issues: string[];
};

const BLACKHOLE_NAME = /blackhole|black hole/i;

export function isUsableState(endpoint: AudioEndpoint): boolean {
  return endpoint.state === "active";
}

export function detectBlackHole(catalog: EndpointCatalog): BlackHoleDetection {
  const input =
    catalog.endpoints.find(
      (endpoint) =>
        endpoint.kind === "capture" &&
        BLACKHOLE_NAME.test(endpoint.friendlyName),
    ) ?? null;
  const output =
    catalog.endpoints.find(
      (endpoint) =>
        endpoint.kind === "render" &&
        BLACKHOLE_NAME.test(endpoint.friendlyName),
    ) ?? null;

  const issues: string[] = [];
  if (
    input !== null &&
    output !== null &&
    isUsableState(input) &&
    isUsableState(output)
  ) {
    return { installed: true, input, output, degraded: false, issues };
  }
  if (input === null || output === null) {
    issues.push(
      "BlackHole was not found. Install it from its official source " +
        "(github.com/ExistentialAudio/BlackHole) and restart the app.",
    );
  }
  if (input !== null && !isUsableState(input)) {
    issues.push(
      `"${input.friendlyName}" is not active (state: ${input.state}). Enable it in Audio MIDI Setup or Sound settings.`,
    );
  }
  if (output !== null && !isUsableState(output)) {
    issues.push(
      `"${output.friendlyName}" is not active (state: ${output.state}). Enable it in Audio MIDI Setup or Sound settings.`,
    );
  }
  return { installed: false, input, output, degraded: true, issues };
}
