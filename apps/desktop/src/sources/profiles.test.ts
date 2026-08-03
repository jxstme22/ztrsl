import { describe, expect, it } from "vitest";

import {
  ASR_PROVIDER_CAPABILITY,
  DEFAULT_PROVIDER_CAPABILITY,
  PROFILE_META,
  PROFILE_OPTIONS,
  capabilityNote,
  providerCapability,
} from "./profiles";
import { languageProfileSchema, languageStrictnessSchema } from "./model";

const PROFILES = [
  "tagalog",
  "taglish",
  "cebuano",
  "bislish",
  "mandarin",
  "chinese_english",
  "auto",
] as const;

describe("profile catalog mirror", () => {
  it("covers every schema profile with metadata", () => {
    for (const profile of PROFILES) {
      expect(PROFILE_META[profile]).toBeDefined();
      expect(PROFILE_META[profile].label.length).toBeGreaterThan(0);
    }
  });

  it("mirrors the sidecar enum exactly (schema is the source of truth)", () => {
    const schemaKeys = languageProfileSchema.options;
    expect(new Set(schemaKeys)).toEqual(new Set(PROFILES));
  });

  it("uses only the three strictness values", () => {
    expect(languageStrictnessSchema.options).toEqual([
      "off",
      "balanced",
      "strict",
    ]);
  });

  it("auto recommends off; others recommend balanced", () => {
    expect(PROFILE_META.auto.recommendedStrictness).toBe("off");
    for (const profile of PROFILES.filter((p) => p !== "auto")) {
      expect(PROFILE_META[profile].recommendedStrictness).toBe("balanced");
    }
  });

  it("profile options are selectable ids", () => {
    const ids = PROFILE_OPTIONS.map((option) => option.value);
    expect(new Set(ids)).toEqual(new Set(PROFILES));
  });
});

describe("capability honesty", () => {
  it("flags fixed-language CTC models as forced", () => {
    expect(ASR_PROVIDER_CAPABILITY.ncspeech).toBe("forced");
    expect(ASR_PROVIDER_CAPABILITY["ncspeech-zh"]).toBe("forced");
    expect(ASR_PROVIDER_CAPABILITY["ncspeech-zh-parakeet"]).toBe("forced");
  });

  it("treats multilingual decoders as non-locking (preferred)", () => {
    expect(ASR_PROVIDER_CAPABILITY.local).toBe("preferred");
    expect(ASR_PROVIDER_CAPABILITY["whisper-turbo"]).toBe("preferred");
    expect(ASR_PROVIDER_CAPABILITY["groq-whisper"]).toBe("preferred");
  });

  it("defaults unknown providers to post-filter (never overclaims)", () => {
    expect(DEFAULT_PROVIDER_CAPABILITY).toBe("post-filter");
    expect(providerCapability(undefined)).toBe("post-filter");
    expect(providerCapability("some-future-provider")).toBe("post-filter");
  });

  it("never claims decoder locking for post-filter providers", () => {
    const note = capabilityNote("demo", "mandarin");
    expect(note.toLowerCase()).not.toContain("fixed to one language");
    expect(note.toLowerCase()).not.toContain("enforced at recognition");
  });

  it("is honest for preferred providers too (no hard lock claim)", () => {
    const note = capabilityNote("local", "tagalog");
    expect(note.toLowerCase()).not.toContain("enforced at recognition");
    expect(note.toLowerCase()).not.toContain("fixed to one language");
  });

  it("can state a hard lock only for a forced provider", () => {
    const note = capabilityNote("ncspeech", "tagalog");
    expect(note.toLowerCase()).toContain("fixed");
  });
});
