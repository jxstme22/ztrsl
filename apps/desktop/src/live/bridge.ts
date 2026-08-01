import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  EMPTY_LIVE_SNAPSHOT,
  liveSnapshotSchema,
  type LiveSnapshot,
} from "./model";

let browserListening = false;

export type TranslationProvider =
  | "madlad"
  | "libretranslate"
  | "google-translate"
  | "mymemory"
  | "custom-http";

export type AsrProvider =
  | "local"
  | "whisper-turbo"
  | "whisper-full"
  | "ncspeech"
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

export async function startLiveTranslation(
  endpointId: string,
  playbackEndpointId: string | null,
  provider: "demo" | "local" | "http",
  monitorEnabled: boolean,
  sourceMode: "filipino" | "chinese",
  asrProvider: AsrProvider,
  translationProvider: TranslationProvider,
  vadSensitivity = 50,
): Promise<LiveSnapshot> {
  if (!isTauri()) {
    browserListening = true;
    return {
      ...EMPTY_LIVE_SNAPSHOT,
      state: "listening",
      provider: "demo",
      asrModel: "browser-preview",
      sourceMode,
      resourceProfile: "quality",
    };
  }
  return liveSnapshotSchema.parse(
    await invoke("start_live_translation", {
      request: {
        endpointId,
        playbackEndpointId: playbackEndpointId ?? "",
        sourceMode,
        provider,
        asrProvider,
        translationProvider,
        resourceProfile: "quality",
        monitorEnabled,
        vadSensitivity,
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
