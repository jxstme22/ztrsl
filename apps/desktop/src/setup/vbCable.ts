import type { AudioEndpoint, EndpointCatalog } from "../audio/model";

/**
 * DS-500: virtual-cable device detection (VB-CABLE, BlackHole, …).
 *
 * A virtual audio cable appears as an ordinary endpoint pair: a RENDER
 * device that apps play INTO and a CAPTURE device the app records FROM.
 * Detection is purely name-based over the ordinary endpoint catalog — no
 * driver access, no game interaction. Names are detection hints only:
 * stable endpoint ids are stored, never names, and a manual override
 * always remains available.
 */

export type VirtualCableDetection = {
  /** Render devices the user can route application audio INTO. */
  playbackCandidates: AudioEndpoint[];
  /** Capture devices the app can record FROM. */
  recordingCandidates: AudioEndpoint[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

const CABLE_PLAYBACK_PATTERNS = [/cable\s+input/i, /vb-audio\s+virtual\s+cable/i];
const CABLE_CAPTURE_PATTERNS = [/cable\s+output/i, /vb-audio\s+virtual\s+cable/i];
/** macOS virtual devices expose their input as a capture endpoint. */
const BLACKHOLE_PATTERN = /blackhole|black\s+hole/i;

export function isUsableState(endpoint: AudioEndpoint): boolean {
  return endpoint.state === "active";
}

export function detectVirtualCables(
  catalog: EndpointCatalog,
): VirtualCableDetection {
  const playbackCandidates: AudioEndpoint[] = [];
  const recordingCandidates: AudioEndpoint[] = [];
  const warnings: string[] = [];
  let matchedAny = false;

  for (const endpoint of catalog.endpoints) {
    const name = endpoint.friendlyName;
    if (
      endpoint.kind === "render" &&
      (CABLE_PLAYBACK_PATTERNS.some((pattern) => pattern.test(name)) ||
        BLACKHOLE_PATTERN.test(name))
    ) {
      matchedAny = true;
      playbackCandidates.push(endpoint);
    } else if (
      endpoint.kind === "capture" &&
      (CABLE_CAPTURE_PATTERNS.some((pattern) => pattern.test(name)) ||
        BLACKHOLE_PATTERN.test(name))
    ) {
      matchedAny = true;
      recordingCandidates.push(endpoint);
    }
  }

  const usablePlayback = playbackCandidates.filter(isUsableState);
  const usableRecording = recordingCandidates.filter(isUsableState);

  if (playbackCandidates.length === 0 && recordingCandidates.length === 0) {
    warnings.push(
      "A virtual audio cable was not found. Install VB-CABLE (vb-audio.com) " +
        "or BlackHole (macOS) separately and refresh devices.",
    );
  } else {
    if (usablePlayback.length === 0 && playbackCandidates.length > 0) {
      warnings.push("The cable playback device is present but not active.");
    }
    if (usableRecording.length === 0 && recordingCandidates.length > 0) {
      warnings.push("The cable recording device is present but not active.");
    }
  }

  // Multiple cables are legitimate: list every candidate and let the user
  // pick. High confidence only when at least one usable pair exists.
  const confidence: "high" | "medium" | "low" =
    usablePlayback.length > 0 && usableRecording.length > 0
      ? "high"
      : matchedAny
        ? "medium"
        : "low";

  return {
    playbackCandidates: usablePlayback,
    recordingCandidates: usableRecording,
    confidence,
    warnings,
  };
}

/** Strict single-cable view for the Sources page card (v0.6.x behavior). */
export type VbCableDetection = {
  installed: boolean;
  input: AudioEndpoint | null;
  output: AudioEndpoint | null;
  degraded: boolean;
  issues: string[];
};

export function detectVbCable(catalog: EndpointCatalog): VbCableDetection {
  const { playbackCandidates, recordingCandidates, warnings } =
    detectVirtualCables(catalog);
  const input =
    playbackCandidates.find((endpoint) =>
      /cable\s+input/i.test(endpoint.friendlyName),
    ) ?? null;
  const output =
    recordingCandidates.find((endpoint) =>
      /cable\s+output/i.test(endpoint.friendlyName),
    ) ?? null;
  return {
    installed: input !== null && output !== null,
    input,
    output,
    degraded: input !== null && output !== null ? false : true,
    issues: warnings,
  };
}
