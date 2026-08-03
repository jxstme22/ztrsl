import { sourceConfigsSchema, type SourceConfigs } from "./model";
import { migrateFromV02 } from "./migration";
import { loadOverlaySettings } from "../overlay/storage";

/**
 * Schema v3 persistence (spec §1.4). Separate key from overlay settings:
 * overlay placement/hotkeys stay versioned independently.
 */

export const SOURCE_CONFIGS_KEY = "local-squad-translator.sources.v3";

export function loadSourceConfigs(
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): SourceConfigs {
  const serialized = storage.getItem(SOURCE_CONFIGS_KEY);

  if (serialized !== null) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      const result = sourceConfigsSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    } catch {
      // fall through to migration
    }
  }

  // First run (or corrupt v3 payload): migrate from v0.2 state and persist so
  // the generated source id stays stable across restarts.
  const overlay = loadOverlaySettings(storage);
  const { configs } = migrateFromV02(null, overlay);
  storage.setItem(SOURCE_CONFIGS_KEY, JSON.stringify(configs));
  return configs;
}

export function saveSourceConfigs(
  configs: SourceConfigs,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(SOURCE_CONFIGS_KEY, JSON.stringify(configs));
}

export function removeSourceConfigs(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(SOURCE_CONFIGS_KEY);
}
