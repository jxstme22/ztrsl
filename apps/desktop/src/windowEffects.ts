import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export function isMacos(): boolean {
  return navigator.userAgent.includes("Mac");
}

// Native window look for the control window. The window is transparent
// (tauri.conf.json). `apply_window_shell` applies the platform glass:
// - Windows: acrylic system backdrop (`DWMSBT_TRANSIENTWINDOW`), which really
//   blurs the desktop behind the window — unlike Mica, which renders a static
//   opaque light sheet — and asks DWM for native corner rounding.
// - macOS: an NSVisualEffectView vibrancy layer behind the webview, so the
//   CSS translucent surfaces + backdrop-filter read as frosted glass (without
//   it a transparent webview renders flat black).
// Re-applied once after creation because the window manager may reset the
// attributes while the surface settles. Harmless no-op in the browser preview.

let overlayWindowPromise: Promise<WebviewWindow | null> | null | undefined;

function isOverlayWindow(): boolean {
  return (
    new URLSearchParams(window.location.search).get("window") === "overlay"
  );
}

async function applyWindowShell(): Promise<void> {
  if (!isTauri() || isOverlayWindow()) {
    return;
  }
  try {
    await invoke("apply_window_shell");
  } catch (error) {
    console.warn("[window-effects] window shell failed", error);
  }
}

/** Resolves to the applied effect ("acrylic", "vibrancy") or why none applied. */
export function getLiquidGlassStatus(): Promise<string> {
  return Promise.resolve(
    !isTauri()
      ? "preview"
      : isOverlayWindow()
        ? "overlay"
        : navigator.userAgent.includes("Mac")
          ? "vibrancy"
          : "acrylic",
  );
}

export function applyLiquidGlass(): Promise<void> {
  if (!isTauri() || isOverlayWindow()) {
    return Promise.resolve();
  }
  return (async () => {
    await applyWindowShell();
    // DWM may reset the backdrop/corner attributes right after creation, so
    // re-apply once after the window manager settles.
    globalThis.setTimeout(() => {
      void applyWindowShell();
    }, 400);
  })();
}

// Windowed overlay mode: the control window morphs into a compact
// always-on-top caption strip (Rust `set_overlay_mode`). Used on macOS,
// where the separate always-on-top overlay window renders black — a
// transparent webview needs the app's vibrancy layer behind it.
export function setWindowedOverlay(active: boolean): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return invoke("set_overlay_mode", { active }).then(() => undefined);
}

// The caption overlay is an always-on-top OS window, so CSS z-index inside
// the control window can never lift a dropdown above it. While a dropdown is
// open, hide the overlay window entirely — hiding is deterministic regardless
// of z-order or always-on-top edge cases — and restore it on close.
export function setOverlayVisible(visible: boolean): void {
  if (!isTauri() || isOverlayWindow() || isMacos()) {
    return;
  }
  if (overlayWindowPromise === undefined) {
    overlayWindowPromise = WebviewWindow.getByLabel("overlay");
  }
  void overlayWindowPromise?.then((overlay) => {
    if (overlay !== null) {
      if (visible) {
        void overlay.show();
      } else {
        void overlay.hide();
      }
    }
  });
}
