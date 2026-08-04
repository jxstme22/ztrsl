import { z } from "zod";

import { captionPayloadSchema } from "../ipc/model";

export const liveMetricsSchema = z.object({
  capturedFrames: z.number().int().nonnegative(),
  audioPacketsSent: z.number().int().nonnegative(),
  captureDrops: z.number().int().nonnegative(),
  monitorDrops: z.number().int().nonnegative(),
  monitorUnderrunSamples: z.number().int().nonnegative(),
  captionsReceived: z.number().int().nonnegative(),
});

export const liveSnapshotSchema = z.object({
  state: z.enum(["listening", "stopped", "error"]),
  provider: z.string().nullable(),
  asrModel: z.string().nullable(),
  asrRuntime: z.string().nullable(),
  translationRuntime: z.string().nullable(),
  sourceMode: z.string().nullable(),
  targetLanguage: z.string().nullable(),
  resourceProfile: z.string().nullable(),
  metrics: liveMetricsSchema,
  captions: z.array(captionPayloadSchema).max(64),
  error: z.string().nullable(),
  /** Non-fatal capture stall warning; null when audio is flowing. */
  warning: z.string().nullable().default(null),
});

export type LiveSnapshot = z.infer<typeof liveSnapshotSchema>;

export const EMPTY_LIVE_SNAPSHOT: LiveSnapshot = {
  state: "stopped",
  provider: null,
  asrModel: null,
  asrRuntime: null,
  translationRuntime: null,
  sourceMode: null,
  targetLanguage: null,
  resourceProfile: null,
  metrics: {
    capturedFrames: 0,
    audioPacketsSent: 0,
    captureDrops: 0,
    monitorDrops: 0,
    monitorUnderrunSamples: 0,
    captionsReceived: 0,
  },
  captions: [],
  error: null,
  warning: null,
};
