import { describe, expect, it } from "vitest";

import { YOU_ACCENT_COLOR, YOU_SOURCE_ID } from "../captions/history";
import {
  DEFAULT_YOU_CONFIG,
  buildYouSourceRequest,
  loadYouConfig,
  resolveYouDirection,
  saveYouConfig,
} from "./config";

describe("resolveYouDirection", () => {
  it("always honors the configured pair, even while a live session runs", () => {
    const direction = resolveYouDirection({
      ...DEFAULT_YOU_CONFIG,
      sourceMode: "english",
      targetLanguage: "zh",
    });
    expect(direction).toEqual({ sourceMode: "english", targetLanguage: "zh" });
  });

  it("does not mirror the live pair (auto-reverse was removed)", () => {
    const direction = resolveYouDirection({
      ...DEFAULT_YOU_CONFIG,
      sourceMode: "english",
      targetLanguage: "zh",
    });
    expect(direction).toEqual({ sourceMode: "english", targetLanguage: "zh" });
  });

  it("honors an explicit pair", () => {
    const direction = resolveYouDirection({
      ...DEFAULT_YOU_CONFIG,
      sourceMode: "filipino",
      targetLanguage: "en",
    });
    expect(direction).toEqual({ sourceMode: "filipino", targetLanguage: "en" });
  });
});

describe("buildYouSourceRequest", () => {
  it("returns null until a mic endpoint is configured", () => {
    const source = buildYouSourceRequest({
      ...DEFAULT_YOU_CONFIG,
      micEndpointId: null,
    });
    expect(source).toBeNull();
  });

  it("builds the you-source with the fixed id, tag and accent color", () => {
    const source = buildYouSourceRequest(
      {
        ...DEFAULT_YOU_CONFIG,
        micEndpointId: "mic-1",
        sourceMode: "english",
        targetLanguage: "zh",
      },
      "nllb",
    );
    expect(source).not.toBeNull();
    expect(source?.sourceId).toBe(YOU_SOURCE_ID);
    expect(source?.endpointId).toBe("mic-1");
    expect(source?.displayName).toBe("You");
    expect(source?.captionTag).toBe("YOU");
    expect(source?.color).toBe(YOU_ACCENT_COLOR);
    expect(source?.sourceOrigin).toBe("physical_microphone");
    // the explicitly chosen pair is always honored (no auto-reverse)
    expect(source?.languageProfile).toBe("english");
    expect(source?.targetLanguage).toBe("zh");
    expect(source?.translationProvider).toBe("nllb");
  });
});

describe("you config persistence", () => {
  it("round-trips through storage", () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };
    const config = {
      ...DEFAULT_YOU_CONFIG,
      micEndpointId: "mic-9",
      autoReverse: false,
      sourceMode: "thai" as const,
      targetLanguage: "en" as const,
    };
    saveYouConfig(config, fakeStorage);
    expect(loadYouConfig(fakeStorage)).toEqual(config);
  });

  it("returns defaults when storage is empty or corrupted", () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };
    expect(loadYouConfig(fakeStorage)).toEqual(DEFAULT_YOU_CONFIG);
    storage.set("lst.you.config.v1", "{not json");
    expect(loadYouConfig(fakeStorage)).toEqual(DEFAULT_YOU_CONFIG);
  });
});
