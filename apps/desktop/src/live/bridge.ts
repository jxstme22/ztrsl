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
  | "nvidia-riva-4b"
  | "nvidia-riva-1.6b"
  | "libretranslate"
  | "google-translate"
  | "mymemory"
  | "baidu-translate"
  | "custom-http";

export type AsrProvider =
  | "local"
  | "whisper-turbo"
  | "whisper-full"
  | "ncspeech"
  | "ncspeech-zh"
  | "ncspeech-zh-parakeet"
  | "paraformer-zh-streaming"
  | "sensevoice-small"
  | "nvidia-whisper-large-v3"
  | "nvidia-nemotron-asr-streaming"
  | "nvidia-parakeet-1.1b"
  | "nvidia-canary-1b"
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

export type TargetLanguage =
  "en" | "zh" | "fil" | "ind" | "vie" | "tha" | "zsm";

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
  sourceOrigin?: string;
  languageConfig?: {
    primaryLanguage: string | null;
    secondaryLanguages: string[];
    detectionMode: string;
  } | null;
  /** Per-source translation direction (e.g. the user's mic reversed from
   * the session default). Optional; absent = session default. */
  targetLanguage?: string | null;
  translationProvider?: string | null;
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
  segmentation: "chunk" | "balanced" | "sentence" = "balanced",
  sources: LiveSourceRequest[] = [],
  micSource: LiveSourceRequest | null = null,
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
        segmentation,
        sources,
        micSource,
      },
    }),
  );
}

/** Flip the "you" mic stream on/off on the running live session. Returns the
 * new state. Errors when no live session is running or the mic stream was
 * not configured at live start. */
export async function setLiveMicEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri()) {
    return enabled;
  }
  return await invoke("set_live_mic_enabled", { enabled });
}

/** Start the SEPARATED live session (a second, independent live translation
 * started from the history page). It shares the sidecar process — and its
 * loaded models — with the main live session, but has its own endpoint and
 * configuration, and records into the same history session. */
export async function startSeparatedLiveTranslation(
  endpointId: string,
  playbackEndpointId: string | null,
  provider: "demo" | "local" | "http",
  monitorEnabled: boolean,
  sourceMode: SourceMode,
  targetLanguage: TargetLanguage,
  asrProvider: AsrProvider,
  translationProvider: TranslationProvider,
  vadSensitivity = 50,
  segmentation: "chunk" | "balanced" | "sentence" = "balanced",
  sources: LiveSourceRequest[] = [],
): Promise<LiveSnapshot> {
  if (!isTauri()) {
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
    await invoke("start_separated_live_translation", {
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
        segmentation,
        sources,
      },
    }),
  );
}

export async function fetchSeparatedLiveSnapshot(): Promise<LiveSnapshot> {
  if (!isTauri()) {
    return EMPTY_LIVE_SNAPSHOT;
  }
  return liveSnapshotSchema.parse(
    await invoke("separated_live_translation_snapshot"),
  );
}

export async function stopSeparatedLiveTranslation(): Promise<LiveSnapshot> {
  if (!isTauri()) {
    return EMPTY_LIVE_SNAPSHOT;
  }
  return liveSnapshotSchema.parse(
    await invoke("stop_separated_live_translation"),
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
