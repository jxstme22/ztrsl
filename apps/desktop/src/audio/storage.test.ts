import { describe, expect, it } from "vitest";

import { loadSelectedEndpointId, saveSelectedEndpointId } from "./storage";

describe("audio endpoint persistence", () => {
  it("round-trips a stable endpoint ID", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    saveSelectedEndpointId("{0.0.1.00000000}.virtual-cable", storage);
    expect(loadSelectedEndpointId(storage)).toBe(
      "{0.0.1.00000000}.virtual-cable",
    );
  });

  it("rejects malformed persisted data", () => {
    const storage = {
      getItem: () => JSON.stringify({ endpointId: 42 }),
    };
    expect(loadSelectedEndpointId(storage)).toBeNull();
  });
});
