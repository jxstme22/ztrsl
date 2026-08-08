import { z } from "zod";

import { YOU_ACCENT_COLOR, YOU_SOURCE_ID } from "../captions/history";
import type { LiveSourceRequest, SourceMode, TargetLanguage } from "../live/bridge";

/** Caption tag stamped on "you" captions by the sidecar. */
export const YOU_CAPTION_TAG = "YOU";

/** Target-language codes → ASR source modes (the app uses different token
 * sets for MT output and ASR input). */
function targetToSourceMode(target: string): SourceMode | null {
  switch (target) {
    case "en": return "english";
    case "zh": return "chinese";
    case "fil": return "filipino";
    case "ind": return "indonesian";
    case "vie": return "vietnamese";
    case "tha": return "thai";
    case "zsm": return "malay";
    default: return null;
  }
}

/** ASR source modes → target-language codes. */
function sourceModeToTarget(source: string): TargetLanguage | null {
  switch (source) {
    case "english": return "en";
    case "chinese": return "zh";
    case "filipino": return "fil";
    case "indonesian": return "ind";
    case "vietnamese": return "vie";
    case "thai": return "tha";
    case "malay": return "zsm";
    default: return null;
  }
}

/**
 * The user's voice & chat config. The YOU stream rides the SAME live
 * session — same ASR model, same translation model, same provider — so the
 * only thing the user picks here is the language pair (and which mic).
 * `autoReverse` mirrors the live pair reversed (live en→zh ⇒ you zh→en);
 * when no live session is running the explicit pair is used instead.
 */
export const youStreamConfigSchema = z.object({
  /** Mic endpoint id; null until the user picks one. */
  micEndpointId: z.string().nullable(),
  autoReverse: z.boolean().default(true),
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
  autoReverse: true,
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
 * Resolve the effective voice/chat direction for the "you" stream. With
 * auto-reverse and a live session, the pair mirrors the live one (source =
 * live target, target = live source); otherwise the configured pair wins.
 */
export function resolveYouDirection(
  config: YouStreamConfig,
  live: {
    sourceMode: string | null;
    targetLanguage: string | null;
  },
): { sourceMode: SourceMode; targetLanguage: TargetLanguage } {
  if (
    config.autoReverse &&
    live.sourceMode !== null &&
    live.targetLanguage !== null
  ) {
    const reversedTarget = sourceModeToTarget(live.sourceMode);
    const reversedSource = targetToSourceMode(live.targetLanguage);
    if (reversedTarget !== null && reversedSource !== null) {
      return {
        sourceMode: reversedSource,
        targetLanguage: reversedTarget,
      };
    }
  }
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
  live: {
    sourceMode: string | null;
    targetLanguage: string | null;
  },
  liveTranslationProvider = "nllb",
): LiveSourceRequest | null {
  if (config.micEndpointId === null) {
    return null;
  }
  const { sourceMode, targetLanguage } = resolveYouDirection(config, live);
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
