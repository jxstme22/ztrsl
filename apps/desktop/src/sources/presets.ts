import { z } from "zod";

import {
  type AudioSourceConfig,
  type CaptionLabelStyle,
  type LanguageProfile,
  type LanguageStrictness,
} from "./model";
import { createSourceId } from "./identity";

/**
 * Editable source presets (spec §4.1). Presets are starting points: every
 * field except the immutable `sourceId` can be edited afterwards.
 */

export const sourcePresetSchema = z.enum([
  "valorant-team",
  "discord",
  "party-chat",
  "browser-voice",
  "custom",
]);
export type SourcePresetId = z.infer<typeof sourcePresetSchema>;

export type SourcePreset = {
  id: SourcePresetId;
  label: string;
  description: string;
  displayName: string;
  captionTag: string;
  labelStyle: CaptionLabelStyle;
  color: string | null;
  languageProfile: LanguageProfile;
  strictness: LanguageStrictness;
};

export const SOURCE_PRESETS: readonly SourcePreset[] = [
  {
    id: "valorant-team",
    label: "Valorant Team",
    description: "In-game voice chat, Tagalog by default",
    displayName: "Valorant Team",
    captionTag: "TEAM",
    labelStyle: "brackets",
    color: "#7dd3fc",
    languageProfile: "tagalog",
    strictness: "balanced",
  },
  {
    id: "discord",
    label: "Discord",
    description: "Friends on Discord voice, Cebuano by default",
    displayName: "Discord",
    captionTag: "DISCORD",
    labelStyle: "brackets",
    color: "#a78bfa",
    languageProfile: "cebuano",
    strictness: "balanced",
  },
  {
    id: "party-chat",
    label: "Party Chat",
    description: "Mixed Taglish party voice",
    displayName: "Party Chat",
    captionTag: "PARTY",
    labelStyle: "brackets",
    color: "#fca5a5",
    languageProfile: "taglish",
    strictness: "balanced",
  },
  {
    id: "browser-voice",
    label: "Browser Voice",
    description: "Voice chat in the browser, language detected",
    displayName: "Browser Voice",
    captionTag: "BROWSER",
    labelStyle: "brackets",
    color: "#86efac",
    languageProfile: "auto",
    strictness: "off",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Start blank and configure everything",
    displayName: "Custom Source",
    captionTag: "SRC",
    labelStyle: "brackets",
    color: null,
    languageProfile: "tagalog",
    strictness: "balanced",
  },
];

export function getSourcePreset(id: SourcePresetId): SourcePreset {
  const preset = SOURCE_PRESETS.find((p) => p.id === id);
  if (preset === undefined) {
    throw new Error(`unknown source preset: ${id}`);
  }
  return preset;
}

/**
 * Build a new source from a preset with a fresh immutable id. `overrides`
 * apply after the preset (never touching the generated `sourceId`).
 */
export function createSourceFromPreset(
  presetId: SourcePresetId,
  overrides: Partial<
    Pick<
      AudioSourceConfig,
      "displayName" | "captionTag" | "labelStyle" | "color"
    >
  > = {},
  random: () => number = Math.random,
): AudioSourceConfig {
  const preset = getSourcePreset(presetId);
  return {
    sourceId: createSourceId(random),
    displayName: overrides.displayName ?? preset.displayName,
    captionTag: overrides.captionTag ?? preset.captionTag,
    labelStyle: overrides.labelStyle ?? preset.labelStyle,
    color: overrides.color !== undefined ? overrides.color : preset.color,
    captureTarget: { kind: "endpoint", endpointId: null },
    monitoring: { enabled: false, headphoneEndpointId: null, volume: 0.5 },
    languageProfile: preset.languageProfile,
    strictness: preset.strictness,
  };
}
