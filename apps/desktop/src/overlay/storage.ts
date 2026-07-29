import {
  DEFAULT_OVERLAY_SETTINGS,
  overlaySettingsSchema,
  type OverlaySettings,
} from "./model";

const OVERLAY_SETTINGS_KEY = "local-squad-translator.overlay.v1";

export function loadOverlaySettings(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): OverlaySettings {
  const serialized = storage.getItem(OVERLAY_SETTINGS_KEY);
  if (serialized === null) {
    return DEFAULT_OVERLAY_SETTINGS;
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = overlaySettingsSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_OVERLAY_SETTINGS;
  } catch {
    return DEFAULT_OVERLAY_SETTINGS;
  }
}

export function saveOverlaySettings(
  settings: OverlaySettings,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(OVERLAY_SETTINGS_KEY, JSON.stringify(settings));
}
