import {
  DEFAULT_OVERLAY_SETTINGS,
  overlaySettingsSchema,
  type OverlaySettings,
} from "./model";

const OVERLAY_SETTINGS_KEY = "local-squad-translator.overlay.v1";

/** Promote a schemaVersion:1 settings document (pre-Phase 8) to v2, keeping
 * every existing value and filling the new multi-source fields with the
 * default "show both lanes, no primary, nothing hidden" behavior. */
function migrateV1ToV2(value: unknown): OverlaySettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = { ...(value as Record<string, unknown>) };
  if (candidate.schemaVersion !== 1) {
    return null;
  }
  candidate.schemaVersion = 2;
  candidate.primarySourceId = null;
  candidate.hiddenSourceIds = [];
  candidate.simultaneousPolicy = "show-both";
  const result = overlaySettingsSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

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
    if (result.success) {
      return result.data;
    }
    const migrated = migrateV1ToV2(parsed);
    if (migrated !== null) {
      return migrated;
    }
    return DEFAULT_OVERLAY_SETTINGS;
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
