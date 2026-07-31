import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  EMPTY_LIVE_SNAPSHOT,
  liveSnapshotSchema,
  type LiveSnapshot,
} from "./model";

let browserListening = false;

export async function startLiveTranslation(
  endpointId: string,
  playbackEndpointId: string,
  provider: "demo" | "local",
): Promise<LiveSnapshot> {
  if (!isTauri()) {
    browserListening = true;
    return {
      ...EMPTY_LIVE_SNAPSHOT,
      state: "listening",
      provider: "demo",
      asrModel: "browser-preview",
      sourceMode: "filipino",
      resourceProfile: "quality",
    };
  }
  return liveSnapshotSchema.parse(
    await invoke("start_live_translation", {
      request: {
        endpointId,
        playbackEndpointId,
        sourceMode: "filipino",
        provider,
        resourceProfile: "quality",
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
