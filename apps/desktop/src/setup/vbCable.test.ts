import { describe, expect, it } from "vitest";

import type { AudioEndpoint, EndpointCatalog } from "../audio/model";
import { detectVbCable } from "./vbCable";

function endpoint(overrides: Partial<AudioEndpoint>): AudioEndpoint {
  return {
    id: `dev://${overrides.kind ?? "capture"}-${String(Math.random())}`,
    friendlyName: "Unrelated device",
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
  // "CABLE Input" is a render (playback) endpoint: apps play voice into it.
  kind: "render",
});
const CABLE_OUTPUT = endpoint({
  id: "dev://cable-output",
  friendlyName: "CABLE Output (VB-Audio Virtual Cable)",
  // "CABLE Output" is a capture (recording) endpoint: the app records from it.
  kind: "capture",
});

function catalog(endpoints: AudioEndpoint[]): EndpointCatalog {
  return {
    platform: "windows",
    deviceChangeDetected: false,
    processCaptureSupported: false,
    endpoints,
  };
}

describe("detectVbCable", () => {
  it("reports installed when both CABLE endpoints are active", () => {
    const detection = detectVbCable(catalog([CABLE_INPUT, CABLE_OUTPUT]));
    expect(detection.installed).toBe(true);
    expect(detection.input?.id).toBe("dev://cable-input");
    expect(detection.output?.id).toBe("dev://cable-output");
    expect(detection.degraded).toBe(false);
    expect(detection.issues).toEqual([]);
  });

  it("matches names case-insensitively and without the VB-Audio suffix", () => {
    const detection = detectVbCable(
      catalog([
        endpoint({ id: "a", friendlyName: "cable input", kind: "render" }),
        endpoint({ id: "b", friendlyName: "Cable Output", kind: "capture" }),
      ]),
    );
    expect(detection.installed).toBe(true);
  });

  it("requires both endpoints — a half-installed driver is not installed", () => {
    const onlyInput = detectVbCable(catalog([CABLE_INPUT]));
    expect(onlyInput.installed).toBe(false);
    expect(onlyInput.input).not.toBeNull();
    expect(onlyInput.output).toBeNull();
    expect(onlyInput.issues.join(" ")).toContain("VB-CABLE was not found");

    const onlyOutput = detectVbCable(catalog([CABLE_OUTPUT]));
    expect(onlyOutput.installed).toBe(false);
    expect(onlyOutput.output).not.toBeNull();
    expect(onlyOutput.input).toBeNull();
  });

  it("flags a disabled CABLE endpoint as degraded instead of installed", () => {
    const detection = detectVbCable(
      catalog([
        endpoint({ ...CABLE_INPUT, state: "disabled" }),
        CABLE_OUTPUT,
      ]),
    );
    expect(detection.installed).toBe(false);
    expect(detection.degraded).toBe(true);
    expect(detection.issues.join(" ")).toContain("not active");
  });

  it("ignores unrelated render devices that merely share a name fragment", () => {
    const detection = detectVbCable(
      catalog([
        endpoint({
          id: "dev://usb",
          friendlyName: "USB Headset Cable",
          kind: "render",
        }),
        endpoint({
          id: "dev://mixer",
          friendlyName: "Mixer Capture",
          kind: "capture",
        }),
      ]),
    );
    expect(detection.installed).toBe(false);
    expect(detection.input).toBeNull();
    expect(detection.output).toBeNull();
  });
});
