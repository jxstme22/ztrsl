/**
 * Immutable source identity (ADR-013).
 *
 * `source_id` is a UUID v4, lowercase hex, 32 ASCII characters (16 raw bytes
 * in the v2 audio header slot). It is generated once at source creation and
 * NEVER derived from name, tag, endpoint, or order.
 */

const HEX_CHARS = "0123456789abcdef";
export type SourceId = string;

/** Index into HEX_CHARS; falls back to "0" for out-of-range (never hit). */
function hexAt(index: number): string {
  return HEX_CHARS[index] ?? "0";
}

/** 0..15 → hex digit; using the standard v4 variant bits. */
function randomHexByte(random: () => number): string {
  return hexAt(Math.floor(random() * 16));
}

/**
 * Create a new immutable source id.
 *
 * `random` is injectable for tests; production uses `Math.random` (crypto
 * strength is not a security boundary here — ids must be unique, not secret).
 * jsdom does not implement `crypto.getRandomUUID`, so we derive v4-style
 * nibbles directly instead of depending on the platform.
 */
export function createSourceId(random: () => number = Math.random): SourceId {
  const nibbles: string[] = [];
  for (let i = 0; i < 32; i += 1) {
    nibbles.push(randomHexByte(random));
  }
  // RFC 4122 v4: nibble 12 (index 12) must be 4, nibble 16 (index 16) is the
  // variant and must be 8, 9, a, or b.
  nibbles[12] = "4";
  nibbles[16] = hexAt(8 + Math.floor(random() * 4));
  return nibbles.join("");
}

export function isValidSourceId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

export function sourceIdBytes(sourceId: SourceId): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(sourceId.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function sourceIdFromBytes(bytes: Uint8Array): SourceId {
  if (bytes.length !== 16) {
    throw new Error(`source id requires 16 bytes, got ${String(bytes.length)}`);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
