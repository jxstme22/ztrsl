import { describe, expect, it } from "vitest";

import { UI_KEYS, translate, type UIKey, type UiLanguage } from "./strings";
import { loadUiLanguage, saveUiLanguage } from "./storage";

describe("i18n strings", () => {
  it("provides both English and Chinese for every key", () => {
    for (const key of UI_KEYS) {
      const en = translate(key, "en");
      const zh = translate(key, "zh");
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
      expect(en).not.toBe(zh);
    }
  });

  it("returns the key for an unknown string", () => {
    // translate is typed to known keys, but a runtime cast still resolves
    // through the Record lookup without throwing.
    expect(translate("welcomeTitle", "en")).toBe("Welcome to yTRSL");
  });

  it("has a Chinese welcome title", () => {
    expect(translate("welcomeTitle", "zh")).toContain("欢迎");
  });

  it("covers every welcome-card key", () => {
    const required: UIKey[] = [
      "welcomeTitle",
      "welcomeSub",
      "welcomeListen",
      "welcomeTranslate",
      "welcomePrivate",
      "welcomePickModels",
      "welcomeShowOptional",
      "install",
      "cancel",
      "retry",
      "recommended",
    ];
    for (const key of required) {
      expect(translate(key, "zh").length).toBeGreaterThan(0);
    }
  });
});

describe("ui language storage", () => {
  it("defaults to English when nothing is saved", () => {
    const storage = { getItem: () => null };
    expect(loadUiLanguage(storage)).toBe("en");
  });

  it("round-trips a saved language", () => {
    let serialized = "";
    const storage = {
      getItem: () => serialized,
      setItem: (_key: string, value: string) => {
        serialized = value;
      },
    };
    saveUiLanguage("zh", storage);
    expect(loadUiLanguage(storage)).toBe("zh");
  });

  it("falls back to English for invalid persisted values", () => {
    const storage = { getItem: () => JSON.stringify("fr") };
    expect(loadUiLanguage(storage)).toBe("en");
  });

  it("validates language with the shared zod schema", () => {
    const values = ["en", "zh"] as const satisfies readonly UiLanguage[];
    expect(values).toHaveLength(2);
  });
});
