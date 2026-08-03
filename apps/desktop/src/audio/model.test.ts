import { describe, expect, it } from "vitest";

import { endpointCatalogSchema, levelSnapshotSchema } from "./model";

describe("audio IPC schemas", () => {
  it("rejects an endpoint without a stable ID", () => {
    const result = endpointCatalogSchema.safeParse({
      platform: "windows",
      deviceChangeDetected: false,
      processCaptureSupported: false,
      endpoints: [
        {
          id: "",
          friendlyName: "Cable output",
          kind: "capture",
          state: "active",
          defaultRoles: {
            console: false,
            multimedia: false,
            communications: true,
          },
          nativeFormat: null,
          isSynthetic: false,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a catalog and requires the process capture capability flag", () => {
    const result = endpointCatalogSchema.safeParse({
      platform: "windows",
      deviceChangeDetected: false,
      processCaptureSupported: true,
      endpoints: [],
    });
    expect(result.success).toBe(true);
    expect(
      endpointCatalogSchema.safeParse({
        platform: "windows",
        deviceChangeDetected: false,
        endpoints: [],
      }).success,
    ).toBe(false);
  });

  it("rejects impossible negative meter levels", () => {
    expect(
      levelSnapshotSchema.safeParse({
        sequence: 1,
        peak: -0.1,
        rms: 0,
        clipped: false,
        droppedFrames: 0,
      }).success,
    ).toBe(false);
  });
});
