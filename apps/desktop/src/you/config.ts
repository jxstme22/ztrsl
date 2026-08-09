import { z } from "zod";

import { YOU_ACCENT_COLOR, YOU_SOURCE_ID } from "../captions/history";
import type { LiveSourceRequest, SourceMode, TargetLanguage } from "../live/bridge";

/** Caption tag stamped on "you" captions by the sidecar. */
export const YOU_CAPTION_TAG = "YOU";

/**
 * The user's voice & chat config. The YOU stream rides the SAME live
 * session — same ASR model, same translation model, same provider — so the
 * only thing the user picks here is the language pair (and which mic).
 * The explicitly chosen pair is always honored: there is no auto-reverse.
 * `autoReverse` is tolerated in stored configs for backwards compatibility
 * but is ignored (it was removed from the UI because it silently overrode
 * the user's explicit pair).
 */
export const youStreamConfigSchema = z.object({
  /** Mic endpoint id; null until the user picks one. */
  micEndpointId: z.string().nullable(),
  /** Kept only so older stored configs still parse; no longer used. */
  autoReverse: z.boolean().default(false),
  sourceMode: z
    .enum([
      "filipino",
      "chinese",
      "english",
      "indonesian",
      "vietnamese",
      "thai",
      "malay",
    ])
    .default("chinese"),
  targetLanguage: z
    .enum(["en", "zh", "fil", "ind", "vie", "tha", "zsm"])
    .default("en"),
});

export type YouStreamConfig = z.infer<typeof youStreamConfigSchema>;

const YOU_CONFIG_KEY = "lst.you.config.v1";

export const DEFAULT_YOU_CONFIG: YouStreamConfig = {
  micEndpointId: null,
  autoReverse: false,
  sourceMode: "chinese",
  targetLanguage: "en",
};

export function loadYouConfig(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): YouStreamConfig {
  const serialized = storage.getItem(YOU_CONFIG_KEY);
  if (serialized !== null) {
    try {
      const parsed = youStreamConfigSchema.safeParse(JSON.parse(serialized));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Fall through to defaults.
    }
  }
  return DEFAULT_YOU_CONFIG;
}

export function saveYouConfig(
  config: YouStreamConfig,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(YOU_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Resolve the effective voice/chat direction for the "you" stream. The
 * explicitly configured pair always wins — auto-reverse was removed from the
 * UI because it silently overrode the user's choice (an en→zh mic was flipped
 * to zh→en whenever a live session ran, which English-only ASR providers
 * reject).
 */
export function resolveYouDirection(
  config: YouStreamConfig,
): { sourceMode: SourceMode; targetLanguage: TargetLanguage } {
  return {
    sourceMode: config.sourceMode,
    targetLanguage: config.targetLanguage,
  };
}

/**
 * Build the sidecar LiveSourceRequest for the user's own mic stream. Returns
 * null when no mic endpoint is configured (the mic button is disabled until
 * the user picks one in the config dialog). The you-stream rides the same
 * live session, so its translation provider mirrors the live page's.
 */
export function buildYouSourceRequest(
  config: YouStreamConfig,
  liveTranslationProvider = "nllb",
): LiveSourceRequest | null {
  if (config.micEndpointId === null) {
    return null;
  }
  const { sourceMode, targetLanguage } = resolveYouDirection(config);
  return {
    sourceId: YOU_SOURCE_ID,
    endpointId: config.micEndpointId,
    displayName: "You",
    captionTag: YOU_CAPTION_TAG,
    languageProfile: sourceMode,
    strictness: "off",
    labelStyle: "brackets",
    color: YOU_ACCENT_COLOR,
    sourceOrigin: "physical_microphone",
    targetLanguage,
    translationProvider: liveTranslationProvider,
  };
}

/** ASR providers that can recognize the user's own voice in any of the app
 * languages (multilingual Whisper-family backends). */
export const YOU_ASR_OPTIONS: readonly {
  value: string;
  modelId: string;
}[] = [
  { value: "whisper-turbo", modelId: "whisper-large-v3-turbo" },
  { value: "whisper-full", modelId: "whisper-large-v3" },
  { value: "mlx-whisper", modelId: "mlx-whisper-large-v3-turbo-q4" },
  { value: "sensevoice-small", modelId: "sensevoice-small" },
];

/** Translation providers usable for the "you" chat/voice direction. */
export const YOU_TRANSLATION_OPTIONS: readonly {
  value: string;
  modelId: string;
}[] = [
  { value: "nllb", modelId: "nllb-200-distilled-600M-ct2-int8" },
  { value: "madlad", modelId: "madlad400-3b-mt" },
];
