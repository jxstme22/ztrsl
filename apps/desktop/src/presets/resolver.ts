import { getDomainPreset } from "./catalog";
import { DEFAULT_QUALITY_PROFILE_ID, type QualityProfileId } from "./quality";
import { DEFAULT_SOURCE_ORIGIN, type SourceOrigin } from "../sources/model";
import { policy_for_origin } from "./originPolicy";

/**
 * DS-600: preset resolver.
 *
 * Effective configuration = explicit user override
 *   > saved source override
 *   > domain preset
 *   > source-origin default
 *   > global default.
 * Pure and unit-tested; updating preset catalogs never overwrites saved
 * overrides (overrides are applied per-field, after resolution).
 */

export type EffectiveConfig = {
  domainPresetId: string;
  qualityProfileId: QualityProfileId;
  vadProfileId: string;
  sourceOrigin: SourceOrigin;
  normalize: boolean;
  glossaryPackId: string | null;
  hotwordPackId: string | null;
  overlapPolicy: string;
  contextPolicy: string;
};

export type ResolverOverrides = Partial<{
  domainPresetId: string;
  qualityProfileId: QualityProfileId;
  vadProfileId: string;
  sourceOrigin: SourceOrigin;
}>;

export const GLOBAL_DEFAULT_PRESET_ID = "general";

export function resolveEffectiveConfig(options: {
  sourceOverride?: Partial<{
    domainPresetId: string;
    qualityProfileId: QualityProfileId;
    vadProfileId: string;
    sourceOrigin: SourceOrigin;
  }>;
  userOverrides?: ResolverOverrides;
  qualityProfileId?: QualityProfileId;
}): EffectiveConfig {
  const domainPresetId =
    options.userOverrides?.domainPresetId ??
    options.sourceOverride?.domainPresetId ??
    GLOBAL_DEFAULT_PRESET_ID;
  const sourceOrigin =
    options.userOverrides?.sourceOrigin ??
    options.sourceOverride?.sourceOrigin ??
    DEFAULT_SOURCE_ORIGIN;
  const qualityProfileId =
    options.userOverrides?.qualityProfileId ??
    options.sourceOverride?.qualityProfileId ??
    options.qualityProfileId ??
    DEFAULT_QUALITY_PROFILE_ID;

  const preset = getDomainPreset(domainPresetId);
  const vadProfileId =
    options.userOverrides?.vadProfileId ??
    options.sourceOverride?.vadProfileId ??
    preset?.vadProfileId ??
    "natural_conversation";
  const originPolicy = policy_for_origin(sourceOrigin);

  return {
    domainPresetId,
    qualityProfileId,
    vadProfileId,
    sourceOrigin,
    normalize: originPolicy.normalize,
    glossaryPackId: preset?.glossaryPackId ?? null,
    hotwordPackId: preset?.hotwordPackId ?? null,
    overlapPolicy: preset?.overlapPolicy ?? "mark_uncertain",
    contextPolicy: preset?.contextPolicy ?? "normal",
  };
}

/** Diagnostics helper: show why a route was chosen. */
export function resolveExplain(
  options: Parameters<typeof resolveEffectiveConfig>[0],
): { effective: EffectiveConfig; reasons: string[] } {
  const effective = resolveEffectiveConfig(options);
  const reasons: string[] = [];
  if (options.userOverrides?.domainPresetId !== undefined) {
    reasons.push("domain preset: explicit user override");
  } else if (options.sourceOverride?.domainPresetId !== undefined) {
    reasons.push("domain preset: saved source override");
  } else {
    reasons.push("domain preset: global default");
  }
  reasons.push(`quality: ${effective.qualityProfileId}`);
  reasons.push(`origin: ${effective.sourceOrigin}`);
  return { effective, reasons };
}
