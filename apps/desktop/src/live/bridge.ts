import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  EMPTY_LIVE_SNAPSHOT,
  liveSnapshotSchema,
  type LiveSnapshot,
} from "./model";

let browserListening = false;

export type TranslationProvider =
  | "nllb"
  | "madlad"
  | "opus-mt-en-zh"
  | "opus-mt-zh-en"
  | "libretranslate"
  | "google-translate"
  | "mymemory"
  | "custom-http";

export type AsrProvider =
  | "local"
  | "whisper-turbo"
  | "whisper-full"
  | "mlx"
  | "mlx-whisper"
  | "ncspeech"
  | "ncspeech-zh"
  | "ncspeech-zh-parakeet"
  | "paraformer-zh-streaming"
  | "sensevoice-small"
  | "groq-whisper";

export async function setTranslationEnv(
  pairs: [string, string][],
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_translation_env", {
    request: { pairs },
  });
}

export type SourceMode =
  | "filipino"
  | "chinese"
  | "english"
  | "indonesian"
  | "vietnamese"
  | "thai"
  | "malay";

export type TargetLanguage = "en" | "zh" | "fil" | "ind" | "vie" | "tha" | "zsm";

export type LiveSourceRequest = {
  sourceId: string;
  endpointId: string;
  displayName: string;
  captionTag: string;
  languageProfile: string;
  strictness?: string;
  labelStyle?: string;
  color?: string | null;
  priority?: number;
};

export async function startLiveTranslation(
  endpointId: string,
  playbackEndpointId: string | null,
  provider: "demo" | "local" | "http",
  monitorEnabled: boolean,
  sourceMode: SourceMode,
  targetLanguage: TargetLanguage,
  asrProvider: AsrProvider,
  translationProvider: TranslationProvider,
  vadSensitivity = 50,
  sources: LiveSourceRequest[] = [],
): Promise<LiveSnapshot> {
  if (!isTauri()) {
    browserListening = true;
    return {
      ...EMPTY_LIVE_SNAPSHOT,
      state: "listening",
      provider: "demo",
      asrModel: "browser-preview",
      sourceMode,
      targetLanguage,
      resourceProfile: "quality",
    };
  }
  return liveSnapshotSchema.parse(
    await invoke("start_live_translation", {
      request: {
        endpointId,
        playbackEndpointId: playbackEndpointId ?? "",
        sourceMode,
        targetLanguage,
        provider,
        asrProvider,
        translationProvider,
        resourceProfile: "quality",
        monitorEnabled,
        vadSensitivity,
        sources,
      },
    }),
  );
}

export async function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  if (!isTauri()) {
    return {
      ...EMPTY_LIVE_SNAPSHOT,
      state: browserListening ? "listening" : "stopped",
      provider: "demo",
      asrModel: "browser-preview",
      sourceMode: "filipino",
      resourceProfile: "quality",
    };
  }
  return liveSnapshotSchema.parse(await invoke("live_translation_snapshot"));
}

export async function stopLiveTranslation(): Promise<LiveSnapshot> {
  if (!isTauri()) {
    browserListening = false;
    return EMPTY_LIVE_SNAPSHOT;
  }
  return liveSnapshotSchema.parse(await invoke("stop_live_translation"));
}
