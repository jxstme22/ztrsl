import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  endpointCatalogSchema,
  levelSnapshotSchema,
  type EndpointCatalog,
  type LevelSnapshot,
} from "./model";

const SYNTHETIC_ENDPOINT_ID = "synthetic://phase-2-meter";
let browserSequence = 0;

const BROWSER_CATALOG: EndpointCatalog = {
  platform: "development",
  deviceChangeDetected: false,
  processCaptureSupported: false,
  endpoints: [
    {
      id: SYNTHETIC_ENDPOINT_ID,
      friendlyName: "Generated voice signal (macOS simulator)",
      kind: "capture",
      state: "active",
      defaultRoles: {
        console: false,
        multimedia: false,
        communications: false,
      },
      nativeFormat: { sampleRate: 48_000, channels: 1 },
      isSynthetic: true,
    },
    {
      id: "synthetic://phase-3-headphones",
      friendlyName: "Silent test sink (macOS simulator)",
      kind: "render",
      state: "active",
      defaultRoles: {
        console: false,
        multimedia: false,
        communications: false,
      },
      nativeFormat: { sampleRate: 48_000, channels: 1 },
      isSynthetic: true,
    },
  ],
};

export async function fetchAudioEndpoints(): Promise<EndpointCatalog> {
  if (!isTauri()) {
    return BROWSER_CATALOG;
  }
  return endpointCatalogSchema.parse(await invoke("audio_endpoints"));
}

export async function startAudioMeter(endpointId: string): Promise<void> {
  if (isTauri()) {
    await invoke("start_audio_meter", { endpointId });
  }
  browserSequence = 0;
}

export async function fetchLevelSnapshot(
  endpointId: string,
): Promise<LevelSnapshot> {
  if (isTauri()) {
    return levelSnapshotSchema.parse(
      await invoke("audio_meter_snapshot", { endpointId }),
    );
  }
  browserSequence += 1;
  const peak = 0.18 + 0.48 * (Math.sin(browserSequence * 0.19) * 0.5 + 0.5);
  return {
    sequence: browserSequence,
    peak,
    rms: peak * 0.71,
    clipped: false,
    droppedFrames: 0,
  };
}

export async function stopAudioMeter(): Promise<void> {
  if (isTauri()) {
    await invoke("stop_audio_meter");
  }
}

/**
 * Request microphone access through AVFoundation (the same TCC gate the
 * cpal capture hits). When the status is not yet determined this shows the
 * real macOS permission prompt. Returns "authorized" | "denied" |
 * "restricted" | "notDetermined" | "unsupported".
 */
export async function requestMicrophonePermission(): Promise<
  "authorized" | "denied" | "restricted" | "notDetermined" | "unsupported"
> {
  if (!isTauri()) {
    return "unsupported";
  }
  return await invoke("request_microphone_permission");
}

/** Read the current macOS microphone permission without prompting. */
export async function microphoneAuthStatus(): Promise<
  "authorized" | "denied" | "restricted" | "notDetermined" | "unsupported"
> {
  if (!isTauri()) {
    return "unsupported";
  }
  return await invoke("microphone_auth_status");
}

/** Open the macOS Microphone privacy pane (denied-mic recovery path). */
export async function openMicrophoneSettings(): Promise<void> {
  if (isTauri()) {
    await invoke("open_microphone_settings");
  }
}
