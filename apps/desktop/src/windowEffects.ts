import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// Native window look for the control window. The window is transparent
// (tauri.conf.json). Tauri's `Effect::Acrylic` must NOT be used: on Win11 it
// maps to `DWMSBT_TRANSIENTWINDOW`, a light DWM backdrop that ignores window
// regions and paints the window as a white square. Instead `apply_window_shell`
// enables the dark Mica backdrop (`DWMSBT_MAINWINDOW`) and asks DWM for native
// corner rounding, so the OS window looks like any native app, blurred even
// while unfocused. Re-applied once after creation because DWM may reset the
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

/** Resolves to the applied effect ("acrylic", "mica") or why none applied. */
export function getLiquidGlassStatus(): Promise<string> {
  return Promise.resolve(
    !isTauri()
      ? "preview"
      : isOverlayWindow()
        ? "overlay"
        : "mica",
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

// The caption overlay is an always-on-top OS window, so CSS z-index inside
// the control window can never lift a dropdown above it. While a dropdown is
// open, hide the overlay window entirely — hiding is deterministic regardless
// of z-order or always-on-top edge cases — and restore it on close.
export function setOverlayVisible(visible: boolean): void {
  if (!isTauri() || isOverlayWindow()) {
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
