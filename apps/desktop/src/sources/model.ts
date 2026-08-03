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
  color: sourceColorSchema,
  captureTarget: captureTargetSchema,
  monitoring: monitoringConfigSchema,
  languageProfile: languageProfileSchema,
  strictness: languageStrictnessSchema,
});
export type AudioSourceConfig = z.infer<typeof audioSourceConfigSchema>;

export const MAX_SOURCES = 8;
export const SUGGESTED_TAG_MAX = 16;

export const sourceConfigsSchema = z.object({
  schemaVersion: z.literal(3),
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
    color: null,
    captureTarget: { kind: "endpoint", endpointId: null },
    monitoring: { enabled: false, headphoneEndpointId: null, volume: DEFAULT_MONITOR_VOLUME },
    languageProfile: "tagalog",
    strictness: "balanced",
  };
}
