import { describe, expect, it } from "vitest";

import { loadAppTheme } from "./storage";
import {
  getAppTheme,
  initAppTheme,
  setAppTheme,
  subscribeAppTheme,
} from "./store";

describe("theme store", () => {
  it("defaults to dark and applies it to the document", () => {
    setAppTheme("dark");
    expect(getAppTheme()).toBe("dark");
    initAppTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("propagates theme changes to subscribers", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAppTheme(() => {
      seen.push(getAppTheme());
    });
    setAppTheme("light");
    expect(getAppTheme()).toBe("light");
    expect(seen).toEqual(["light"]);
    // Setting the same value is a no-op.
    setAppTheme("light");
    expect(seen).toEqual(["light"]);
    unsubscribe();
  });

  it("applies the data-theme attribute on switch", () => {
    setAppTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    setAppTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the theme so the next launch reads it back", () => {
    setAppTheme("light");
    expect(loadAppTheme()).toBe("light");
    setAppTheme("dark");
    expect(loadAppTheme()).toBe("dark");
  });

  it("falls back to dark for a corrupt stored value", () => {
    window.localStorage.setItem("local-squad-translator.theme.v1", "neon");
    expect(loadAppTheme()).toBe("dark");
  });
});
