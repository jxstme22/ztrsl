import { describe, expect, it } from "vitest";

import type { AudioEndpoint, EndpointCatalog } from "../audio/model";
import { detectVbCable, detectVirtualCables } from "./vbCable";

function endpoint(
  id: string,
  name: string,
  kind: "render" | "capture",
  state: "active" | "inactive" = "active",
): AudioEndpoint {
  return { id, friendlyName: name, kind, state } as AudioEndpoint;
}

function catalog(endpoints: AudioEndpoint[]): EndpointCatalog {
  return { platform: "windows", endpoints } as EndpointCatalog;
}

const CABLE_INPUT = endpoint("c-in", "CABLE Input", "render");
const CABLE_OUTPUT = endpoint("c-out", "CABLE Output", "capture");

describe("detectVirtualCables (DS-500)", () => {
  it("detects a normal cable pair with high confidence", () => {
    const detection = detectVirtualCables(catalog([CABLE_INPUT, CABLE_OUTPUT]));
    expect(detection.confidence).toBe("high");
    expect(detection.playbackCandidates).toHaveLength(1);
    expect(detection.recordingCandidates).toHaveLength(1);
    expect(detection.warnings).toEqual([]);
  });

  it("handles renamed cables", () => {
    const detection = detectVirtualCables(
      catalog([
        endpoint("r1", "CABLE Input (renamed)", "render"),
        endpoint("r2", "CABLE Output (renamed)", "capture"),
      ]),
    );
    expect(detection.confidence).toBe("high");
    expect(detection.playbackCandidates).toHaveLength(1);
    expect(detection.recordingCandidates).toHaveLength(1);
  });

  it("reports missing cables with low confidence and a warning", () => {
    const detection = detectVirtualCables(
      catalog([endpoint("m1", "Microphone", "capture")]),
    );
    expect(detection.confidence).toBe("low");
    expect(detection.warnings.length).toBeGreaterThan(0);
  });

  it("lists every candidate when multiple cables exist", () => {
    const detection = detectVirtualCables(
      catalog([
        CABLE_INPUT,
        CABLE_OUTPUT,
        endpoint("c2-in", "CABLE Input (2)", "render"),
        endpoint("c2-out", "CABLE Output (2)", "capture"),
      ]),
    );
    expect(detection.playbackCandidates).toHaveLength(2);
    expect(detection.recordingCandidates).toHaveLength(2);
  });

  it("flags inactive devices instead of silently proceeding", () => {
    const detection = detectVirtualCables(
      catalog([
        endpoint("c-in", "CABLE Input", "render", "inactive"),
        CABLE_OUTPUT,
      ]),
    );
    expect(detection.confidence).toBe("medium");
    expect(detection.warnings.some((w) => w.includes("not active"))).toBe(true);
  });

  it("keeps the strict single-cable view for the Sources card", () => {
    expect(detectVbCable(catalog([CABLE_INPUT, CABLE_OUTPUT])).installed).toBe(
      true,
    );
    expect(detectVbCable(catalog([CABLE_INPUT])).installed).toBe(false);
  });
});
