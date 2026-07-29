import { z } from "zod";

export const routingMetricsSchema = z.object({
  capturedFrames: z.number().int().nonnegative(),
  monitorOverflows: z.number().int().nonnegative(),
  monitorUnderruns: z.number().int().nonnegative(),
  inferenceOverflows: z.number().int().nonnegative(),
  clippedMonitorFrames: z.number().int().nonnegative(),
});

export const routingSnapshotSchema = z.object({
  active: z.boolean(),
  monitorPeak: z.number().min(0).max(1),
  inferenceSamples: z.number().int().nonnegative(),
  metrics: routingMetricsSchema,
  backend: z.enum(["synthetic", "wasapi"]),
});

export type RoutingSnapshot = z.infer<typeof routingSnapshotSchema>;

export const EMPTY_ROUTING_SNAPSHOT: RoutingSnapshot = {
  active: false,
  monitorPeak: 0,
  inferenceSamples: 0,
  metrics: {
    capturedFrames: 0,
    monitorOverflows: 0,
    monitorUnderruns: 0,
    inferenceOverflows: 0,
    clippedMonitorFrames: 0,
  },
  backend: "synthetic",
};
