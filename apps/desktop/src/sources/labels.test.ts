import { describe, expect, it } from "vitest";

import { formatPreview, renderLabel } from "./labels";

describe("renderLabel", () => {
  it("renders brackets style", () => {
    expect(renderLabel("TEAM", "brackets")).toEqual({
      label: "[TEAM]",
      stacked: false,
    });
  });

  it("renders colon style", () => {
    expect(renderLabel("TEAM", "colon")).toEqual({
      label: "TEAM:",
      stacked: false,
    });
  });

  it("renders bullet style", () => {
    expect(renderLabel("TEAM", "bullet")).toEqual({
      label: "\u2022 TEAM",
      stacked: false,
    });
  });

  it("renders stacked style", () => {
    expect(renderLabel("TEAM", "stacked")).toEqual({
      label: "TEAM",
      stacked: true,
    });
  });

  it("renders hidden style without a label", () => {
    expect(renderLabel("TEAM", "hidden")).toEqual({
      label: null,
      stacked: false,
    });
  });

  it("never renders empty brackets for blank tags", () => {
    for (const style of [
      "brackets",
      "colon",
      "bullet",
      "stacked",
      "hidden",
    ] as const) {
      expect(renderLabel("", style).label).toBeNull();
      expect(renderLabel("   ", style).label).toBeNull();
    }
  });

  it("trims surrounding whitespace from tags", () => {
    expect(renderLabel("  TEAM  ", "brackets").label).toBe("[TEAM]");
  });
});

describe("formatPreview", () => {
  it("combines label and text inline", () => {
    expect(formatPreview("TEAM", "brackets", "Rotate B!")).toBe(
      "[TEAM] Rotate B!",
    );
    expect(formatPreview("TEAM", "colon", "Let's go")).toBe("TEAM: Let's go");
  });

  it("stacks the label for stacked style", () => {
    expect(formatPreview("TEAM", "stacked", "Rotate B!")).toBe(
      "TEAM\nRotate B!",
    );
  });

  it("omits the label when hidden", () => {
    expect(formatPreview("TEAM", "hidden", "Rotate B!")).toBe("Rotate B!");
  });
});
