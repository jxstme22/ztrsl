import { isTauri } from "@tauri-apps/api/core";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";

// Frosted-window effect for the control window. On Windows 11 the acrylic
// effect maps to the DWM transient-window backdrop, which is the native
// "liquid glass" look when the OS supports it. Blur (ACCENT_ENABLE_BLURBEHIND)
// is deliberately not used: on transparent WebView2 windows it is known to
// render a black backdrop and glitch while dragging. Mica is kept as a second
// choice for builds where the acrylic path is unavailable. Failures fall back
// to the plain transparent window, which the CSS frost layer still works on.
// Harmless no-op in the browser preview.

let statusPromise: Promise<string> | null = null;

/** Resolves to the applied effect ("acrylic", "mica") or why none applied. */
export function getLiquidGlassStatus(): Promise<string> {
  if (statusPromise !== null) {
    return statusPromise;
  }
  return Promise.resolve(
    !isTauri()
      ? "preview"
      : new URLSearchParams(window.location.search).get("window") ===
          "overlay"
        ? "overlay"
        : "unavailable",
  );
}

export function applyLiquidGlass(): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }
  if (new URLSearchParams(window.location.search).get("window") === "overlay") {
    return Promise.resolve();
  }
  statusPromise = (async () => {
    for (const candidate of [Effect.Acrylic, Effect.Mica]) {
      try {
        await getCurrentWindow().setEffects({ effects: [candidate] });
        return candidate === Effect.Acrylic ? "acrylic" : "mica";
      } catch (error) {
        console.warn(`[window-effects] ${candidate} failed`, error);
      }
    }
    return "unavailable";
  })();
  return statusPromise.then(() => undefined);
}
