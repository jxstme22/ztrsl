import { describe, expect, it } from "vitest";

import { MULTI_SOURCE_ENABLED, multiSourceEnabled } from "./featureFlag";

describe("multi-source feature flag", () => {
  it("is enabled for v0.3 development", () => {
    expect(MULTI_SOURCE_ENABLED).toBe(true);
    expect(multiSourceEnabled()).toBe(true);
  });
});
