import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  accuracyLabReportSchema,
  type AccuracyLabReport,
} from "./model";

export type AccuracyConfig = {
  asrName: string;
  translationName: string;
};

/** Run one media file through the selected configs (v0.4 Accuracy Lab).
 * Browser mode returns a demo report so the panel is testable without models. */
export async function compareClips(input: {
  path: string;
  sourceMode: string;
  configs: AccuracyConfig[];
  includeTranscripts?: boolean;
}): Promise<AccuracyLabReport> {
  const configs = input.configs.map((config) => [
    config.asrName,
    config.translationName,
  ]);
  if (!isTauri()) {
    return accuracyLabReportSchema.parse({
      path: input.path,
      sourceMode: input.sourceMode,
      fileSizeBytes: 1024,
      durationSeconds: 7.2,
      capturedAtMs: Date.now(),
      appVersion: "0.4.0-dev",
      runs: input.configs.map((config, index) => ({
        label: `${config.asrName} + ${config.translationName}`,
        asrName: config.asrName,
        translationName: config.translationName,
        asrMs: 18 + index,
        translationMs: 6 + index,
        totalMs: 24 + index,
        modelId: `demo-${config.asrName}+demo-${config.translationName}`,
        errors: [],
        criticalErrors: 0,
        captionCount: 1,
        captions: input.includeTranscripts
          ? [
              {
                startMs: 900,
                endMs: 4100,
                sourceText: "[demo transcript — local ASR model not installed]",
                englishText: "[demo translation — local MT model not installed]",
                warnings: [],
              },
            ]
          : [],
      })),
    });
  }
  return accuracyLabReportSchema.parse(
    await invoke("clip_compare", {
      path: input.path,
      sourceMode: input.sourceMode,
      configs,
      includeTranscripts: input.includeTranscripts ?? false,
    }),
  );
}
