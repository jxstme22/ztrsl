import { z } from "zod";

/**
 * Accuracy Lab types (v0.4 Phase 1). Mirrors the sidecar `clip.compare.completed`
 * payload. Reports are content-free by default (no transcript text) — the
 * desktop never renders unsanitized transcript HTML.
 */

export const accuracyLabRunSchema = z.object({
  label: z.string(),
  asrName: z.string(),
  translationName: z.string(),
  asrMs: z.number().nonnegative(),
  translationMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  modelId: z.string(),
  errors: z.array(z.string()),
  criticalErrors: z.number().int().nonnegative(),
  captionCount: z.number().int().nonnegative(),
  captions: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        sourceText: z.string(),
        englishText: z.string(),
        warnings: z.array(z.string()),
      }),
    )
    .default([]),
});

export type AccuracyLabRun = z.infer<typeof accuracyLabRunSchema>;

export const accuracyLabReportSchema = z.object({
  path: z.string(),
  sourceMode: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  capturedAtMs: z.number().int().nonnegative(),
  appVersion: z.string(),
  runs: z.array(accuracyLabRunSchema).max(8),
});

export type AccuracyLabReport = z.infer<typeof accuracyLabReportSchema>;

/** Configuration presets offered in the UI (display label → sidecar names). */
export const ACCURACY_CONFIGS: readonly {
  label: string;
  asrName: string;
  translationName: string;
}[] = [
  {
    label: "Whisper Turbo + NLLB",
    asrName: "whisper-turbo",
    translationName: "nllb",
  },
  {
    label: "Whisper Full + NLLB",
    asrName: "whisper-full",
    translationName: "nllb",
  },
  {
    label: "Whisper Turbo + MADLAD",
    asrName: "whisper-turbo",
    translationName: "madlad",
  },
  { label: "Demo + Demo", asrName: "demo", translationName: "demo" },
];

export function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

export function formatMilliseconds(ms: number): string {
  return `${String(Math.round(ms))} ms`;
}
