import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  EMPTY_ROUTING_SNAPSHOT,
  routingSnapshotSchema,
  type RoutingSnapshot,
} from "./model";

let browserSequence = 0;

export async function startRouting(
  captureEndpointId: string,
  playbackEndpointId: string,
  volume: number,
): Promise<void> {
  if (isTauri()) {
    await invoke("start_synthetic_routing", {
      captureEndpointId,
      playbackEndpointId,
      volume,
    });
  }
  browserSequence = 0;
}

export async function fetchRoutingSnapshot(): Promise<RoutingSnapshot> {
  if (isTauri()) {
    return routingSnapshotSchema.parse(
      await invoke("synthetic_routing_snapshot"),
    );
  }
  browserSequence += 1;
  return {
    ...EMPTY_ROUTING_SNAPSHOT,
    active: true,
    monitorPeak: 0.16 + 0.44 * (Math.sin(browserSequence * 0.17) * 0.5 + 0.5),
    inferenceSamples: 320,
    metrics: {
      ...EMPTY_ROUTING_SNAPSHOT.metrics,
      capturedFrames: browserSequence,
    },
  };
}

export async function setRoutingVolume(volume: number): Promise<void> {
  if (isTauri()) {
    await invoke("set_synthetic_monitor_volume", { volume });
  }
}

export async function stopRouting(): Promise<void> {
  if (isTauri()) {
    await invoke("stop_synthetic_routing");
  }
}
