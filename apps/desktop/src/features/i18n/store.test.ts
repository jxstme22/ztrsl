import { describe, expect, it } from "vitest";

import { getUiLanguage, setUiLanguage, subscribeUiLanguage } from "./store";
import { loadUiLanguage } from "./storage";

describe("i18n store", () => {
  it("propagates language changes to subscribers (useT re-renders)", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeUiLanguage(() => {
      seen.push(getUiLanguage());
    });
    expect(getUiLanguage()).toBe("en");
    setUiLanguage("zh");
    expect(getUiLanguage()).toBe("zh");
    expect(seen).toEqual(["zh"]);
    // Setting the same value is a no-op.
    setUiLanguage("zh");
    expect(seen).toEqual(["zh"]);
    unsubscribe();
  });

  it("persists the language so the next launch reads it back", () => {
    setUiLanguage("zh");
    expect(loadUiLanguage()).toBe("zh");
    setUiLanguage("en");
    expect(loadUiLanguage()).toBe("en");
  });
});
