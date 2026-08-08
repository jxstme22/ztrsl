import { z } from "zod";

/**
 * DS-203: user-facing quality profiles. Quality profiles express policy,
 * not fixed model names — the model router resolves actual providers later
 * (Phase 6/7). Raw provider selection stays available in Advanced Mode;
 * no provider is removed.
 */

export const QUALITY_PROFILE_IDS = [
  "fast",
  "balanced",
  "best_quality",
  "low_memory",
] as const;
export type QualityProfileId = (typeof QUALITY_PROFILE_IDS)[number];

export const qualityProfileSchema = z.object({
  id: z.enum(QUALITY_PROFILE_IDS),
  provisionalPolicy: z.enum(["enabled", "reduced", "disabled"]),
  finalAccuracyPriority: z.number().int().min(0).max(100),
  maximumExpectedLatencyMs: z.number().int().positive(),
  allowFallbackDecode: z.boolean(),
  memoryClass: z.enum(["low", "medium", "high"]),
});

export type QualityProfile = z.infer<typeof qualityProfileSchema>;

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  fast: {
    id: "fast",
    provisionalPolicy: "enabled",
    finalAccuracyPriority: 40,
    maximumExpectedLatencyMs: 1500,
    allowFallbackDecode: false,
    memoryClass: "low",
  },
  balanced: {
    id: "balanced",
    provisionalPolicy: "enabled",
    finalAccuracyPriority: 60,
    maximumExpectedLatencyMs: 3000,
    allowFallbackDecode: true,
    memoryClass: "medium",
  },
  best_quality: {
    id: "best_quality",
    provisionalPolicy: "reduced",
    finalAccuracyPriority: 100,
    maximumExpectedLatencyMs: 6000,
    allowFallbackDecode: true,
    memoryClass: "high",
  },
  low_memory: {
    id: "low_memory",
    provisionalPolicy: "disabled",
    finalAccuracyPriority: 50,
    maximumExpectedLatencyMs: 5000,
    allowFallbackDecode: false,
    memoryClass: "low",
  },
};

export const DEFAULT_QUALITY_PROFILE_ID: QualityProfileId = "balanced";

const QUALITY_PROFILE_KEY = "lst.qualityProfile";

export function loadQualityProfileId(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): QualityProfileId {
  const stored = storage.getItem(QUALITY_PROFILE_KEY);
  if (
    stored !== null &&
    (QUALITY_PROFILE_IDS as readonly string[]).includes(stored)
  ) {
    return stored as QualityProfileId;
  }
  return DEFAULT_QUALITY_PROFILE_ID;
}

export function saveQualityProfileId(
  id: QualityProfileId,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(QUALITY_PROFILE_KEY, id);
}
