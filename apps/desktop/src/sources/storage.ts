import { sourceConfigsSchema, type SourceConfigs } from "./model";
import { migrateFromV02, migrateFromV03 } from "./migration";
import { loadOverlaySettings } from "../overlay/storage";

/**
 * Schema v4 persistence (spec §1.4, DS-204). v3 documents under the legacy
 * key are migrated on load; the generated source ids stay stable.
 */

export const SOURCE_CONFIGS_KEY = "local-squad-translator.sources.v4";
const LEGACY_V3_KEY = "local-squad-translator.sources.v3";

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

  // v3 payload under the legacy key: migrate it (DS-204) and persist.
  const legacy = storage.getItem(LEGACY_V3_KEY);
  if (legacy !== null) {
    try {
      const parsed: unknown = JSON.parse(legacy);
      const v3 = sourceConfigsSchema.safeParse(
        migrateFromV03(parsed as SourceConfigs),
      );
      if (v3.success) {
        storage.setItem(SOURCE_CONFIGS_KEY, JSON.stringify(v3.data));
        return v3.data;
      }
    } catch {
      // fall through to v0.2 migration
    }
  }

  // First run (or corrupt payload): migrate from v0.2 state and persist so
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
