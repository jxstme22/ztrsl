import { describe, expect, it } from "vitest";

import { DEFAULT_OVERLAY_SETTINGS } from "./model";
import {
  normalizeSettings,
  placementFromPixels,
  resolvePlacement,
  type MonitorGeometry,
} from "./placement";

const PRIMARY: MonitorGeometry = {
  id: "primary",
  x: 0,
  y: 0,
  width: 2560,
  height: 1440,
};

describe("overlay placement", () => {
  it("recovers a missing monitor onto the primary work area", () => {
    const result = resolvePlacement(
      { ...DEFAULT_OVERLAY_SETTINGS, monitorId: "missing" },
      [PRIMARY],
      PRIMARY.id,
    );

    expect(result).not.toBeNull();
    expect(result?.monitorId).toBe(PRIMARY.id);
    expect(result?.recovered).toBe(true);
    expect(result?.x).toBeGreaterThanOrEqual(PRIMARY.x);
    expect(result?.y).toBeGreaterThanOrEqual(PRIMARY.y);
  });

  it("normalizes pixel placement for persistence", () => {
    const settings = placementFromPixels(
      DEFAULT_OVERLAY_SETTINGS,
      PRIMARY,
      512,
      590,
      1280,
    );

    expect(settings.monitorId).toBe(PRIMARY.id);
    expect(settings.widthNormalized).toBe(0.5);
    expect(settings.xNormalized).toBe(0.4);
    expect(settings.yNormalized).toBeCloseTo(590 / (PRIMARY.height - 150), 2);
  });

  it("clamps unsafe values to supported bounds", () => {
    const normalized = normalizeSettings({
      ...DEFAULT_OVERLAY_SETTINGS,
      xNormalized: -1,
      yNormalized: 2,
      widthNormalized: 0.99,
      fontScale: 3,
      backgroundOpacity: 0,
    });

    expect(normalized).toMatchObject({
      xNormalized: 0,
      yNormalized: 1,
      widthNormalized: 0.95,
      fontScale: 1.6,
      backgroundOpacity: 0.35,
    });
  });
});
