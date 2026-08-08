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
  it("auto-reverses the live pair when a live session runs", () => {
    const direction = resolveYouDirection(
      { ...DEFAULT_YOU_CONFIG, autoReverse: true },
      { sourceMode: "english", targetLanguage: "zh" },
    );
    expect(direction).toEqual({ sourceMode: "chinese", targetLanguage: "en" });
  });

  it("falls back to the configured pair when no live session runs", () => {
    const direction = resolveYouDirection(
      { ...DEFAULT_YOU_CONFIG, autoReverse: true },
      { sourceMode: null, targetLanguage: null },
    );
    expect(direction).toEqual({
      sourceMode: DEFAULT_YOU_CONFIG.sourceMode,
      targetLanguage: DEFAULT_YOU_CONFIG.targetLanguage,
    });
  });

  it("honors an explicit pair when auto is off", () => {
    const direction = resolveYouDirection(
      {
        ...DEFAULT_YOU_CONFIG,
        autoReverse: false,
        sourceMode: "filipino",
        targetLanguage: "en",
      },
      { sourceMode: "english", targetLanguage: "zh" },
    );
    expect(direction).toEqual({ sourceMode: "filipino", targetLanguage: "en" });
  });
});

describe("buildYouSourceRequest", () => {
  it("returns null until a mic endpoint is configured", () => {
    const source = buildYouSourceRequest(
      { ...DEFAULT_YOU_CONFIG, micEndpointId: null },
      { sourceMode: "english", targetLanguage: "zh" },
    );
    expect(source).toBeNull();
  });

  it("builds the you-source with the fixed id, tag and accent color", () => {
    const source = buildYouSourceRequest(
      {
        ...DEFAULT_YOU_CONFIG,
        micEndpointId: "mic-1",
      },
      { sourceMode: "english", targetLanguage: "zh" },
      "nllb",
    );
    expect(source).not.toBeNull();
    expect(source?.sourceId).toBe(YOU_SOURCE_ID);
    expect(source?.endpointId).toBe("mic-1");
    expect(source?.displayName).toBe("You");
    expect(source?.captionTag).toBe("YOU");
    expect(source?.color).toBe(YOU_ACCENT_COLOR);
    expect(source?.sourceOrigin).toBe("physical_microphone");
    // auto-reverse of live (en→zh) ⇒ you chinese→en
    expect(source?.languageProfile).toBe("chinese");
    expect(source?.targetLanguage).toBe("en");
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
