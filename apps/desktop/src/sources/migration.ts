import type { OverlaySettings } from "../overlay/model";
import {
  DEFAULT_SOURCE_ORIGIN,
  defaultSourceConfig,
  profileToLanguageConfig,
  type AudioSourceConfig,
  type SourceConfigs,
} from "./model";
import { createSourceId } from "./identity";

/** v3 schema shape (pre-DS-200/201) used only for migration parsing. */
type V3SourceConfig = Omit<
  AudioSourceConfig,
  "sourceOrigin" | "languageConfig"
>;

type V3Configs = {
  schemaVersion: 3;
  sources: V3SourceConfig[];
};

/**
 * DS-204: v3 → v4 migration. Adds `sourceOrigin` (safe generic default —
 * most sources route through a virtual cable) and `languageConfig`
 * (deterministic adapter from the stored language profile; unknown
 * profiles would have failed v3 validation, so full_auto is unreachable
 * from real data but stays the safe fallback). Preserves every existing
 * field; idempotent (v4 documents pass through untouched).
 */
export function migrateFromV03(configs: V3Configs | SourceConfigs): SourceConfigs {
  if (configs.schemaVersion === 4) {
    return configs;
  }
  return {
    schemaVersion: 4,
    sources: configs.sources.map((source) => {
      const legacy = source;
      return {
        ...legacy,
        sourceOrigin: DEFAULT_SOURCE_ORIGIN,
        languageConfig: profileToLanguageConfig(legacy.languageProfile),
      };
    }),
  };
}

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
    configs: { schemaVersion: 4, sources: [source] },
    migrated: true,
  };
}
