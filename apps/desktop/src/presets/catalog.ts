import { z } from "zod";

/**
 * DS-202: data-only domain presets. Presets reference other configuration
 * (VAD profiles, caption profiles, latency profiles, glossary/hotword
 * packs); they never duplicate provider logic and never change live
 * behavior on their own. User overrides are stored separately — updating
 * a preset must not overwrite explicit user overrides.
 */

export const OVERLAP_POLICIES = ["mark_uncertain", "drop_secondary"] as const;
export const CONTEXT_POLICIES = ["short", "normal", "long"] as const;

export const domainPresetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().min(1).max(48),
  vadProfileId: z.string().min(1),
  captionProfileId: z.string().min(1),
  latencyProfileId: z.string().min(1),
  glossaryPackId: z.string().min(1).nullable(),
  hotwordPackId: z.string().min(1).nullable(),
  overlapPolicy: z.enum(OVERLAP_POLICIES),
  contextPolicy: z.enum(CONTEXT_POLICIES),
});

export type DomainPreset = z.infer<typeof domainPresetSchema>;

export const domainPresetCatalogSchema = z
  .object({
    presets: z.array(domainPresetSchema),
  })
  .refine(
    (catalog) =>
      new Set(catalog.presets.map((preset) => preset.id)).size ===
      catalog.presets.length,
    { message: "preset ids must be unique" },
  );

export type DomainPresetCatalog = z.infer<typeof domainPresetCatalogSchema>;

/** Initial catalog (data-only; referenced profiles arrive with DS-400+). */
export const DOMAIN_PRESET_CATALOG: DomainPresetCatalog = {
  presets: [
    {
      id: "general",
      displayName: "General Conversation",
      vadProfileId: "natural_conversation",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "normal",
    },
    {
      id: "valorant",
      displayName: "VALORANT",
      vadProfileId: "fast_callouts",
      captionProfileId: "compact",
      latencyProfileId: "fast",
      glossaryPackId: "valorant",
      hotwordPackId: "valorant",
      overlapPolicy: "drop_secondary",
      contextPolicy: "short",
    },
    {
      id: "gaming",
      displayName: "Gaming",
      vadProfileId: "fast_callouts",
      captionProfileId: "compact",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "drop_secondary",
      contextPolicy: "short",
    },
    {
      id: "discord",
      displayName: "Discord",
      vadProfileId: "natural_conversation",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "normal",
    },
    {
      id: "meeting",
      displayName: "Meeting",
      vadProfileId: "meeting",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: "business_meeting",
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "long",
    },
    {
      id: "streaming",
      displayName: "Streaming",
      vadProfileId: "natural_conversation",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "normal",
    },
    {
      id: "language_learning",
      displayName: "Language Learning",
      vadProfileId: "natural_conversation",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "normal",
    },
    {
      id: "accessibility",
      displayName: "Accessibility",
      vadProfileId: "meeting",
      captionProfileId: "sentence",
      latencyProfileId: "balanced",
      glossaryPackId: null,
      hotwordPackId: null,
      overlapPolicy: "mark_uncertain",
      contextPolicy: "long",
    },
  ],
};

export function getDomainPreset(id: string): DomainPreset | undefined {
  return DOMAIN_PRESET_CATALOG.presets.find((preset) => preset.id === id);
}

export function domainPresetCatalogIsValid(): boolean {
  return domainPresetCatalogSchema.safeParse(DOMAIN_PRESET_CATALOG).success;
}
