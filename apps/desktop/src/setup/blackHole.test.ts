import { describe, expect, it } from "vitest";

import type { EndpointCatalog } from "../audio/model";
import { detectBlackHole } from "./blackHole";

function catalogWith(endpoints: EndpointCatalog["endpoints"]): EndpointCatalog {
  return {
    platform: "macos",
    endpoints,
    deviceChangeDetected: false,
    processCaptureSupported: false,
  };
}

function endpoint(
  name: string,
  kind: "capture" | "render",
  state: "active" | "disabled" = "active",
): EndpointCatalog["endpoints"][number] {
  return {
    id: `id-${name}-${kind}`,
    friendlyName: name,
    kind,
    state,
    defaultRoles: {
      console: false,
      multimedia: false,
      communications: false,
    },
    nativeFormat: null,
    isSynthetic: false,
  };
}

describe("detectBlackHole", () => {
  it("detects a fully installed BlackHole (input + output)", () => {
    const detection = detectBlackHole(
      catalogWith([
        endpoint("MacBook Pro Microphone", "capture"),
        endpoint("BlackHole 2ch", "capture"),
        endpoint("BlackHole 2ch", "render"),
        endpoint("MacBook Pro Speakers", "render"),
      ]),
    );
    expect(detection.installed).toBe(true);
    expect(detection.input?.friendlyName).toBe("BlackHole 2ch");
    expect(detection.output?.friendlyName).toBe("BlackHole 2ch");
    expect(detection.issues).toEqual([]);
  });

  it("reports missing BlackHole with guidance", () => {
    const detection = detectBlackHole(
      catalogWith([
        endpoint("MacBook Pro Microphone", "capture"),
        endpoint("MacBook Pro Speakers", "render"),
      ]),
    );
    expect(detection.installed).toBe(false);
    expect(detection.degraded).toBe(true);
    expect(detection.issues.length).toBeGreaterThan(0);
    expect(detection.issues[0]).toMatch(/BlackHole was not found/i);
  });

  it("flags a disabled BlackHole as degraded", () => {
    const detection = detectBlackHole(
      catalogWith([
        endpoint("BlackHole 2ch", "capture", "disabled"),
        endpoint("BlackHole 2ch", "render", "active"),
      ]),
    );
    expect(detection.installed).toBe(false);
    expect(detection.degraded).toBe(true);
    expect(detection.issues.join(" ")).toMatch(/not active/i);
  });
});
