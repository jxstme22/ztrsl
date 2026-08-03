import { describe, expect, it } from "vitest";

import { formatBytes, formatEta } from "./ModelsPanel";

describe("formatBytes", () => {
  it("formats byte magnitudes compactly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.50 MB");
  });
});

describe("formatEta", () => {
  it("formats seconds as a compact ETA", () => {
    expect(formatEta(0)).toBe("0s");
    expect(formatEta(12)).toBe("12s");
    expect(formatEta(90)).toBe("1m 30s");
    expect(formatEta(120)).toBe("2m");
    expect(formatEta(-5)).toBe("0s");
  });
});
