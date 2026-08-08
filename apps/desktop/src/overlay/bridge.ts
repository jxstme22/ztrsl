import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  PhysicalPosition,
  PhysicalSize,
  Window as TauriWindow,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { z } from "zod";

import { historyEntrySchema, type HistoryEntry } from "../captions/history";
import {
  HOTKEY_ACTIONS,
  overlaySettingsSchema,
  overlaySnapshotSchema,
  type HotkeyAction,
  type HotkeySettings,
  type OverlaySettings,
  type OverlaySnapshot,
} from "./model";
import {
  placementFromPixels,
  resolvePlacement,
  type MonitorGeometry,
} from "./placement";
import { isMacos } from "../windowEffects";

const SNAPSHOT_EVENT = "overlay:snapshot";
const RECOVERED_EVENT = "overlay:recovered";
const SETTINGS_EVENT = "overlay:settings";
const HISTORY_EVENT = "captions:history";
const DONE_EDITING_EVENT = "overlay:done-editing";
const TOGGLE_VIEW_EVENT = "overlay:toggle-view";
const HIDE_EVENT = "overlay:hide";

function monitorId(monitor: Monitor): string {
  return (
    monitor.name ??
    [
      monitor.workArea.position.x,
      monitor.workArea.position.y,
      monitor.workArea.size.width,
      monitor.workArea.size.height,
    ]
      .map(String)
      .join(":")
  );
}

function toGeometry(monitor: Monitor): MonitorGeometry {
  return {
    id: monitorId(monitor),
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  };
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export async function syncOverlayWindow(
  snapshot: OverlaySnapshot,
): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  // On macOS the separate overlay window is disabled — the control window
  // itself becomes the overlay (see `setWindowedOverlay`).
  if (isMacos()) {
    return;
  }

  const overlay = await TauriWindow.getByLabel("overlay");
  if (overlay === null) {
    throw new Error("Overlay window is unavailable");
  }

  await overlay.setIgnoreCursorEvents(snapshot.mode === "play");
  await overlay.setFocusable(snapshot.mode === "edit");
  // Visibility is driven by the overlay window itself (it hides on mount and
  // on every snapshot) so show/hide works even if this window handle misbehaves.
  await emitTo("overlay", SNAPSHOT_EVENT, snapshot);
}

export async function listenForOverlaySnapshots(
  onSnapshot: (snapshot: OverlaySnapshot) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }

  return listen<unknown>(SNAPSHOT_EVENT, ({ payload }) => {
    const parsed = overlaySnapshotSchema.safeParse(payload);
    if (parsed.success) {
      onSnapshot(parsed.data);
    }
  });
}

export async function listenForRecoveredOverlay(
  onRecovered: () => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }

  return listen(RECOVERED_EVENT, onRecovered);
}

/** Push the final-caption history to the overlay window. */
export async function emitHistoryToOverlay(
  entries: HistoryEntry[],
): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await emitTo("overlay", HISTORY_EVENT, entries);
}

/** Overlay finished moving: tell the control window to leave edit mode. */
export async function emitDoneEditing(): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await emitTo("control", DONE_EDITING_EVENT);
}

/** Control window: react when the overlay's "Done" button is pressed. */
export async function listenForDoneEditing(
  onDone: () => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }
  return listen(DONE_EDITING_EVENT, onDone);
}

/** Overlay control strip: swap between the mini caption lane and history. */
export async function emitToggleHistoryView(): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await emitTo("control", TOGGLE_VIEW_EVENT);
}

/** Control window: react when the overlay's view-toggle button is pressed. */
export async function listenForToggleHistoryView(
  onToggle: () => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }
  return listen(TOGGLE_VIEW_EVENT, onToggle);
}

/** Overlay control strip: hide the overlay (stays hidden until shown again). */
export async function emitHideOverlay(): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await emitTo("control", HIDE_EVENT);
}

/** Control window: react when the overlay's close button is pressed. */
export async function listenForHideOverlay(
  onHide: () => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }
  return listen(HIDE_EVENT, onHide);
}

/** Receive live history updates in the overlay window. */
export async function listenForHistory(
  onHistory: (entries: HistoryEntry[]) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }

  return listen<unknown>(HISTORY_EVENT, ({ payload }) => {
    const parsed = z.array(historyEntrySchema).safeParse(payload);
    if (parsed.success) {
      onHistory(parsed.data);
    }
  });
}

export async function listenForOverlaySettings(
  onSettings: (settings: OverlaySettings) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }

  return listen<unknown>(SETTINGS_EVENT, ({ payload }) => {
    const parsed = overlaySettingsSchema.safeParse(payload);
    if (parsed.success) {
      onSettings(parsed.data);
    }
  });
}

export async function restoreOverlayPlacement(
  settings: OverlaySettings,
): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }

  const monitors = await availableMonitors();
  const primary = await primaryMonitor();
  const resolved = resolvePlacement(
    settings,
    monitors.map(toGeometry),
    primary === null ? null : monitorId(primary),
  );

  if (resolved === null) {
    return;
  }

  const overlay = getCurrentWindow();
  await overlay.setSize(new PhysicalSize(resolved.width, resolved.height));
  await overlay.setPosition(new PhysicalPosition(resolved.x, resolved.y));

  if (resolved.recovered) {
    await emitTo("control", RECOVERED_EVENT);
  }
}

export async function persistCurrentOverlayPlacement(
  settings: OverlaySettings,
): Promise<OverlaySettings> {
  if (!isDesktopRuntime()) {
    return settings;
  }

  const overlay = getCurrentWindow();
  const monitor = await currentMonitor();
  const position = await overlay.outerPosition();
  const size = await overlay.outerSize();

  if (monitor === null) {
    return settings;
  }

  const next = placementFromPixels(
    settings,
    toGeometry(monitor),
    position.x,
    position.y,
    size.width,
    size.height,
  );
  await emitTo("control", SETTINGS_EVENT, next);
  return next;
}

export async function beginOverlayDrag(): Promise<void> {
  if (isDesktopRuntime()) {
    await getCurrentWindow().startDragging();
  }
}

export type HotkeyErrors = Partial<Record<HotkeyAction, string>>;

export async function registerHotkeys(
  settings: HotkeySettings,
  onAction: (action: HotkeyAction) => void,
): Promise<HotkeyErrors> {
  if (!isDesktopRuntime()) {
    return {};
  }

  await unregisterAll();
  const errors: HotkeyErrors = {};
  const used = new Set<string>();

  for (const { action } of HOTKEY_ACTIONS) {
    const shortcut = settings[action].trim();
    const normalized = shortcut.toLocaleLowerCase();

    if (used.has(normalized)) {
      errors[action] = "Choose a different shortcut.";
      continue;
    }
    used.add(normalized);

    try {
      await register(shortcut, ({ state }) => {
        if (state === "Pressed") {
          onAction(action);
        }
      });
    } catch {
      errors[action] = "This shortcut is invalid or already in use.";
    }
  }

  return errors;
}

export async function unregisterHotkeys(): Promise<void> {
  if (isDesktopRuntime()) {
    await unregisterAll();
  }
}
