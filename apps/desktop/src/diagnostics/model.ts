import { z } from "zod";

/**
 * Diagnostics snapshot types (Phase 10). These mirror the sidecar's
 * `source.diagnostics`, `scheduler.metrics`, and per-source language-filter
 * counters so the Diagnostics panel can render them without leaking content.
 * Transcripts are NEVER part of these payloads.
 */

export const sourceDiagnosticsSchema = z.object({
  sourceId: z.string().regex(/^[0-9a-f]{32}$/),
  active: z.boolean(),
  openUtteranceSamples: z.number().int().nonnegative(),
  utteranceSequence: z.number().int().nonnegative(),
  packetsReceived: z.number().int().nonnegative(),
  utterancesCompleted: z.number().int().nonnegative(),
  captionsEmitted: z.number().int().nonnegative(),
  lowConfidenceCaptions: z.number().int().nonnegative(),
  utterancesDropped: z.number().int().nonnegative(),
  filter: z
    .object({
      applied: z.number().int().nonnegative(),
      suppressed: z.number().int().nonnegative(),
      flagged: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      off: z.number().int().nonnegative(),
    })
    .optional(),
});
export type SourceDiagnostics = z.infer<typeof sourceDiagnosticsSchema>;

export const schedulerMetricsSchema = z.object({
  finalsSubmitted: z.number().int().nonnegative(),
  provisionalsSubmitted: z.number().int().nonnegative(),
  finalsCompleted: z.number().int().nonnegative(),
  provisionalsCompleted: z.number().int().nonnegative(),
  provisionalsCoalesced: z.number().int().nonnegative(),
  provisionalsDropped: z.number().int().nonnegative(),
  finalsDropped: z.number().int().nonnegative(),
  overloadEvents: z.number().int().nonnegative(),
  queueDepth: z.number().int().nonnegative(),
  oldestQueuedMs: z.number().nonnegative(),
  avgQueueDelayMs: z.number().nonnegative(),
  maxQueueDelayMs: z.number().nonnegative(),
});
export type SchedulerMetrics = z.infer<typeof schedulerMetricsSchema>;

export const leakageReportSchema = z.object({
  /** True when the fake multi-source roundtrip stayed isolated. */
  passed: z.boolean(),
  checkedAtMs: z.number().nonnegative(),
  detail: z.string(),
});
export type LeakageReport = z.infer<typeof leakageReportSchema>;

export const diagnosticsSnapshotSchema = z.object({
  capturedAtMs: z.number().nonnegative(),
  sources: z.array(sourceDiagnosticsSchema),
  scheduler: schedulerMetricsSchema.optional(),
  leakage: leakageReportSchema.optional(),
});
export type DiagnosticsSnapshot = z.infer<typeof diagnosticsSnapshotSchema>;

export const EMPTY_DIAGNOSTICS: DiagnosticsSnapshot = {
  capturedAtMs: 0,
  sources: [],
};

export function schedulerCoalescingRate(metrics: SchedulerMetrics): number {
  const submitted = metrics.provisionalsSubmitted + metrics.finalsSubmitted;
  if (submitted === 0) {
    return 0;
  }
  return metrics.provisionalsCoalesced / submitted;
}
