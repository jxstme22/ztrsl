import { describe, expect, it } from "vitest";

import {
  accuracyLabReportSchema,
  formatDuration,
  formatMilliseconds,
} from "./model";

const REPORT = {
  path: "/tmp/clip.mp4",
  sourceMode: "mixed",
  fileSizeBytes: 1024,
  durationSeconds: 7.2,
  capturedAtMs: 1234,
  appVersion: "0.4.0-dev",
  runs: [
    {
      label: "demo + demo",
      asrName: "demo",
      translationName: "demo",
      asrMs: 18,
      translationMs: 6,
      totalMs: 24,
      modelId: "demo+demo",
      errors: [],
      criticalErrors: 0,
      captionCount: 1,
      captions: [],
    },
  ],
};

describe("Accuracy Lab model", () => {
  it("parses a content-free report", () => {
    const parsed = accuracyLabReportSchema.parse(REPORT);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.captionCount).toBe(1);
  });

  it("accepts an optional transcript-included report", () => {
    const withCaptions = {
      ...REPORT,
      runs: [
        {
          ...REPORT.runs[0],
          captions: [
            {
              startMs: 0,
              endMs: 1000,
              sourceText: "kumusta",
              englishText: "hello",
              warnings: [],
            },
          ],
        },
      ],
    };
    const parsed = accuracyLabReportSchema.parse(withCaptions);
    expect(parsed.runs[0]?.captions[0]?.englishText).toBe("hello");
  });

  it("formats durations and latencies", () => {
    expect(formatDuration(7.2)).toBe("7.2s");
    expect(formatMilliseconds(18.4)).toBe("18 ms");
  });
});
