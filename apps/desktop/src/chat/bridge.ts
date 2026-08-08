import { invoke, isTauri } from "@tauri-apps/api/core";

import type {
  SourceMode,
  TargetLanguage,
  TranslationProvider,
} from "../live/bridge";

export type TranslateTextResult = {
  translatedText: string;
  provider: string;
  latencyMs: number;
};

/**
 * One-shot typed-chat translation. Works standalone: the sidecar is spawned
 * on demand and reused, so no live session is required. Errors surface as
 * rejected promises with a user-readable message.
 */
export async function translateText(
  text: string,
  sourceMode: SourceMode,
  targetLanguage: TargetLanguage,
  translationProvider: TranslationProvider,
): Promise<TranslateTextResult> {
  if (!isTauri()) {
    return {
      translatedText: `[browser preview] ${text}`,
      provider: "demo",
      latencyMs: 0,
    };
  }
  return await invoke("translate_text", {
    text,
    sourceMode,
    targetLanguage,
    translationProvider,
  });
}
