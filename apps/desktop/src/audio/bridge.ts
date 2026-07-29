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
  endpoints: [
    {
      id: SYNTHETIC_ENDPOINT_ID,
      friendlyName: "Synthetic voice meter (development)",
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
      friendlyName: "Synthetic headphones (development)",
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
