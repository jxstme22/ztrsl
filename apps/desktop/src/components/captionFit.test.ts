import { describe, expect, it } from "vitest";

import { fitScaleForLength } from "./captionFit";

describe("fitScaleForLength", () => {
  it("keeps the full size for short captions", () => {
    expect(fitScaleForLength(0)).toBe(1);
    expect(fitScaleForLength(30)).toBe(1);
    expect(fitScaleForLength(60)).toBe(1);
  });

  it("shrinks gradually as the caption grows", () => {
    const mid = fitScaleForLength(100);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.7);
  });

  it("floors at the minimum scale for very long captions", () => {
    expect(fitScaleForLength(140)).toBe(0.7);
    expect(fitScaleForLength(1000)).toBe(0.7);
  });

  it("returns stable two-decimal values for CSS variables", () => {
    for (const length of [61, 75, 90, 110, 139]) {
      const value = fitScaleForLength(length);
      expect(Math.round(value * 100)).toBeCloseTo(value * 100, 6);
    }
  });
});
