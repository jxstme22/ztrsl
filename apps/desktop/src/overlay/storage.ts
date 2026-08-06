import {
  DEFAULT_OVERLAY_SETTINGS,
  overlaySettingsSchema,
  type OverlaySettings,
} from "./model";

const OVERLAY_SETTINGS_KEY = "local-squad-translator.overlay.v1";

/** Promote a schemaVersion:1 settings document (pre-Phase 8) to v3, keeping
 * every existing value and filling the new multi-source fields with the
 * default "show both lanes, no primary, nothing hidden" behavior, plus the
 * v3 visual defaults (transparent mini lane, taller window). */
function migrateV1ToV3(value: unknown): OverlaySettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = { ...(value as Record<string, unknown>) };
  if (candidate.schemaVersion !== 1) {
    return null;
  }
  candidate.schemaVersion = 3;
  candidate.primarySourceId = null;
  candidate.hiddenSourceIds = [];
  candidate.simultaneousPolicy = "show-both";
  candidate.backgroundOpacity = 0.25;
  candidate.heightNormalized = 0.3;
  const result = overlaySettingsSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** Promote a schemaVersion:2 settings document (pre v0.6.8 overlay) to v3:
 * the mini caption lane is now far more transparent and the overlay window
 * starts taller (multi-row captions). Existing user placement/rows/hotkeys
 * are kept. */
function migrateV2ToV3(value: unknown): OverlaySettings | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = { ...(value as Record<string, unknown>) };
  if (candidate.schemaVersion !== 2) {
    return null;
  }
  candidate.schemaVersion = 3;
  candidate.backgroundOpacity = 0.25;
  candidate.heightNormalized = 0.3;
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
    const migrated = migrateV1ToV3(parsed);
    if (migrated !== null) {
      return migrated;
    }
    const migratedV3 = migrateV2ToV3(parsed);
    if (migratedV3 !== null) {
      return migratedV3;
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
