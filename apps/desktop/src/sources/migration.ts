import type { OverlaySettings } from "../overlay/model";
import { defaultSourceConfig, type SourceConfigs } from "./model";
import { createSourceId } from "./identity";

/**
 * v0.2 → v3 migration (spec §1.4, Phase 1).
 *
 * v0.2 had exactly one implicit source and no persisted live-session config
 * (capture endpoint, provider, and source mode were in-memory choices). The
 * only persisted user state is the overlay settings document. Migration maps:
 *
 * - overlay `showSource: false` → migrated source label style `hidden`
 *   (the user chose not to see source markers);
 * - everything else → defaults (endpoint unassigned, resolved in Phase 3/4).
 *
 * Migration is idempotent: when a v3 document already exists it is returned
 * untouched with `migrated: false`. The generated `sourceId` is persisted on
 * first migration so it is stable across restarts.
 */

export type MigrationResult = {
  configs: SourceConfigs;
  /** True when a v3 document was created from v0.2 state this call. */
  migrated: boolean;
};

export function migrateFromV02(
  existing: SourceConfigs | null,
  overlaySettings: OverlaySettings | null,
  random: () => number = Math.random,
): MigrationResult {
  if (existing !== null) {
    return { configs: existing, migrated: false };
  }

  const source = defaultSourceConfig();
  source.sourceId = createSourceId(random);
  if (overlaySettings !== null && !overlaySettings.showSource) {
    source.labelStyle = "hidden";
  }

  return {
    configs: { schemaVersion: 3, sources: [source] },
    migrated: true,
  };
}
