import { z } from "zod";

/**
 * v0.4 phrase-filter + glossary editor models (BUILD_PLAN_V0_4 §7/§8).
 * These mirror the sidecar rule sets so the desktop can edit and hot-reload
 * them over IPC.
 */

export const phraseMatchModeSchema = z.enum([
  "exact",
  "contains",
  "similar",
  "regex",
]);
export type PhraseMatchMode = z.infer<typeof phraseMatchModeSchema>;

export const phraseFilterRuleSchema = z.object({
  sourceId: z.string().regex(/^[0-9a-f]{32}$/),
  text: z.string().min(1).max(256),
  matchMode: phraseMatchModeSchema.default("exact"),
  threshold: z.number().min(0).max(1).default(0.87),
  enabled: z.boolean().default(true),
});
export type PhraseFilterRule = z.infer<typeof phraseFilterRuleSchema>;

export const phraseFilterSetSchema = z.object({
  schemaVersion: z.literal(1),
  rules: z.array(phraseFilterRuleSchema).max(200),
});
export type PhraseFilterSet = z.infer<typeof phraseFilterSetSchema>;

export const EMPTY_PHRASE_FILTER_SET: PhraseFilterSet = {
  schemaVersion: 1,
  rules: [],
};

export const glossaryEntryTypeSchema = z.enum([
  "preserve",
  "asr_correction",
  "preferred_translation",
  "alias",
]);
export type GlossaryEntryType = z.infer<typeof glossaryEntryTypeSchema>;

export const glossaryScopeSchema = z.enum([
  "global",
  "source",
  "language_profile",
  "model",
]);
export type GlossaryScope = z.infer<typeof glossaryScopeSchema>;

export const glossaryEntrySchema = z.object({
  entryType: glossaryEntryTypeSchema,
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  scope: glossaryScopeSchema.default("global"),
  scopeKey: z.string().max(64).nullable().default(null),
  note: z.string().max(128).default(""),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

export const glossarySetSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(glossaryEntrySchema).max(500),
});
export type GlossarySet = z.infer<typeof glossarySetSchema>;

export const EMPTY_GLOSSARY_SET: GlossarySet = {
  schemaVersion: 1,
  entries: [],
};
