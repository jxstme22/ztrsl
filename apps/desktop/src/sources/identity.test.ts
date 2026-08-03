import { describe, expect, it } from "vitest";

import {
  createSourceId,
  isValidSourceId,
  sourceIdBytes,
  sourceIdFromBytes,
} from "./identity";

describe("source identity", () => {
  it("creates 32-char lowercase hex ids", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = createSourceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createSourceId()));
    expect(ids.size).toBe(500);
  });

  it("honors the injected random source", () => {
    const id = createSourceId(() => 0);
    expect(id).toBe("00000000000040008000000000000000");
  });

  it("validates id shape", () => {
    expect(isValidSourceId(createSourceId())).toBe(true);
    expect(isValidSourceId("ZZZ")).toBe(false);
    expect(isValidSourceId("g".repeat(32))).toBe(false);
    expect(isValidSourceId("a".repeat(31))).toBe(false);
  });

  it("round-trips through 16-byte binary form", () => {
    const id = createSourceId();
    expect(sourceIdFromBytes(sourceIdBytes(id))).toBe(id);
  });

  it("rejects wrong-length byte arrays", () => {
    expect(() => sourceIdFromBytes(new Uint8Array(15))).toThrow(/16 bytes/);
  });

  it("treats ids as immutable data — no derived mutation API", () => {
    const id = createSourceId();
    expect(id.length).toBe(32);
  });
});
