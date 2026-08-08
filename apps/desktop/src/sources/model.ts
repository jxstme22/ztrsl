import { z } from "zod";

import { createSourceId } from "./identity";

/**
 * v0.3 multi-source domain model (schema v3).
 *
 * Identity rule (ADR-013/ADR-015): `sourceId` is the ONLY identity and is
 * immutable. `displayName` and `captionTag` are editable presentation metadata
 * and must never be used as keys in queues, IPC, persistence, or revisions.
 */

export const captionLabelStyleSchema = z.enum([
  "brackets",
  "colon",
  "bullet",
  "stacked",
  "hidden",
]);
export type CaptionLabelStyle = z.infer<typeof captionLabelStyleSchema>;

/** Horizontal alignment of a caption's text paragraph (v0.5.1). */
export const captionAlignmentSchema = z.enum(["left", "center", "right"]);
export type CaptionAlignment = z.infer<typeof captionAlignmentSchema>;
export const DEFAULT_CAPTION_ALIGNMENT: CaptionAlignment = "center";

export const languageProfileSchema = z.enum([
  "tagalog",
  "taglish",
  "cebuano",
  "bislish",
  "mandarin",
  "chinese_english",
  "auto",
]);
export type LanguageProfile = z.infer<typeof languageProfileSchema>;

/**
 * DS-200: where a source's audio originates. Describes the origin for
 * policy purposes (e.g. normalization, suppression) — it never replaces
 * the capture endpoint. Users can always edit it.
 */
export const sourceOriginSchema = z.enum([
  "virtual_voice_channel",
  "physical_microphone",
  "application_audio",
  "system_mix",
  "recorded_file",
]);
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;

export const DEFAULT_SOURCE_ORIGIN: SourceOrigin = "virtual_voice_channel";

/**
 * DS-201: explicit language configuration replacing a single profile
 * string as the sole representation of recognition language behavior.
 * The profile string remains for display/compatibility; `languageConfig`
 * carries the actual intent.
 */
export const detectionModeSchema = z.enum([
  "fixed",
  "primary_preferred",
  "limited_auto",
  "full_auto",
]);
export type DetectionMode = z.infer<typeof detectionModeSchema>;

export const languageConfigSchema = z
  .object({
    /** ISO-639-1/2 primary language, or null when nothing is fixed. */
    primaryLanguage: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .nullable(),
    secondaryLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)),
    detectionMode: detectionModeSchema,
  })
  .refine(
    (config) =>
      config.detectionMode !== "fixed" &&
      config.detectionMode !== "primary_preferred"
        ? true
        : config.primaryLanguage !== null,
    {
      message: "fixed and primary_preferred require a primary language",
    },
  )
  .refine(
    (config) =>
      config.detectionMode !== "limited_auto" ||
      config.secondaryLanguages.length >= 1,
    {
      message: "limited_auto requires at least one allowed language",
    },
  )
  .refine(
    (config) =>
      config.primaryLanguage === null ||
      !config.secondaryLanguages.includes(config.primaryLanguage),
    {
      message: "primary language cannot be duplicated in secondary languages",
    },
  );
export type LanguageConfig = z.infer<typeof languageConfigSchema>;

/** Deterministic profile → LanguageConfig adapter (DS-201 compatibility). */
export function profileToLanguageConfig(
  profile: LanguageProfile,
): LanguageConfig {
  switch (profile) {
    case "mandarin":
      return {
        primaryLanguage: "zh",
        secondaryLanguages: [],
        detectionMode: "fixed",
      };
    case "chinese_english":
      return {
        primaryLanguage: "zh",
        secondaryLanguages: ["en"],
        detectionMode: "primary_preferred",
      };
    case "tagalog":
      return {
        primaryLanguage: "tl",
        secondaryLanguages: [],
        detectionMode: "fixed",
      };
    case "taglish":
      return {
        primaryLanguage: "tl",
        secondaryLanguages: ["en"],
        detectionMode: "primary_preferred",
      };
    case "cebuano":
      return {
        primaryLanguage: "ceb",
        secondaryLanguages: ["en"],
        detectionMode: "primary_preferred",
      };
    case "bislish":
      return {
        primaryLanguage: "ceb",
        secondaryLanguages: ["en"],
        detectionMode: "primary_preferred",
      };
    case "auto":
      return {
        primaryLanguage: null,
        secondaryLanguages: [],
        detectionMode: "full_auto",
      };
  }
}

export const languageStrictnessSchema = z.enum(["off", "balanced", "strict"]);
export type LanguageStrictness = z.infer<typeof languageStrictnessSchema>;

export const captureTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("endpoint"),
    /**
     * WASAPI endpoint id. `null` means "not assigned yet" — the user picks an
     * endpoint during setup (Phase 4) or from the audio device list.
     */
    endpointId: z.string().max(256).nullable(),
  }),
  z.object({
    kind: z.literal("process"),
    /** Process image name, e.g. "VALORANT.exe". Never a path. */
    processName: z.string().min(1).max(128),
  }),
]);
export type CaptureTarget = z.infer<typeof captureTargetSchema>;

export const monitoringConfigSchema = z.object({
  /** Headphone blend for this source's audio. NEVER fed to ASR. */
  enabled: z.boolean(),
  /** Playback endpoint id used for monitoring; required when enabled. */
  headphoneEndpointId: z.string().max(256).nullable(),
  /** Blend gain 0..1. Defaulted on load so stored v3 payloads stay valid. */
  volume: z.number().min(0).max(1).default(0.5),
});
export type MonitoringConfig = z.infer<typeof monitoringConfigSchema>;

export const DEFAULT_MONITOR_VOLUME = 0.5;

export const sourceColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  .nullable();
export type SourceColor = z.infer<typeof sourceColorSchema>;

export const audioSourceConfigSchema = z.object({
  /**
   * Immutable identity (UUID v4 lowercase hex, 32 chars). Never derived from
   * name/tag/endpoint/order. Never reused after deletion.
   */
  sourceId: z.string().regex(/^[0-9a-f]{32}$/),
  displayName: z.string().trim().min(1).max(48),
  /** Short tag shown on captions (e.g. "TEAM"). 1..32 chars, ≤16 suggested. */
  captionTag: z.string().trim().min(1).max(32),
  labelStyle: captionLabelStyleSchema,
  /** Per-source caption paragraph alignment. Defaults to center (global). */
  captionAlignment: captionAlignmentSchema.default(DEFAULT_CAPTION_ALIGNMENT),
  color: sourceColorSchema,
  captureTarget: captureTargetSchema,
  monitoring: monitoringConfigSchema,
  languageProfile: languageProfileSchema,
  strictness: languageStrictnessSchema,
  /** DS-200: audio origin for policy selection (never replaces the endpoint). */
  sourceOrigin: sourceOriginSchema.default(DEFAULT_SOURCE_ORIGIN),
  /** DS-201: explicit language configuration (profile stays for display). */
  languageConfig: languageConfigSchema.default({
    primaryLanguage: null,
    secondaryLanguages: [],
    detectionMode: "full_auto",
  }),
});
export type AudioSourceConfig = z.infer<typeof audioSourceConfigSchema>;

export const MAX_SOURCES = 8;
export const SUGGESTED_TAG_MAX = 16;

export const sourceConfigsSchema = z.object({
  schemaVersion: z.literal(4),
  sources: z.array(audioSourceConfigSchema).min(1).max(MAX_SOURCES),
});
export type SourceConfigs = z.infer<typeof sourceConfigsSchema>;

export const DEFAULT_SOURCE_COLOR: SourceColor = null;

export function defaultSourceConfig(): AudioSourceConfig {
  return {
    sourceId: createSourceId(),
    displayName: "Valorant Team",
    captionTag: "TEAM",
    labelStyle: "brackets",
    captionAlignment: DEFAULT_CAPTION_ALIGNMENT,
    color: null,
    captureTarget: { kind: "endpoint", endpointId: null },
    monitoring: {
      enabled: false,
      headphoneEndpointId: null,
      volume: DEFAULT_MONITOR_VOLUME,
    },
    languageProfile: "tagalog",
    strictness: "balanced",
    sourceOrigin: DEFAULT_SOURCE_ORIGIN,
    languageConfig: profileToLanguageConfig("tagalog"),
  };
}
