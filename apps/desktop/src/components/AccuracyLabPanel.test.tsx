import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccuracyLabPanel } from "./AccuracyLabPanel";

const mockCompareClips = vi.fn();

vi.mock("../features/accuracy-lab/bridge", () => ({
  compareClips: (...args: unknown[]): ReturnType<typeof mockCompareClips> =>
    mockCompareClips(...args),
}));

const DEMO_REPORT = {
  path: "browser-demo.mp4",
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

describe("AccuracyLabPanel", () => {
  it("runs a comparison and renders the config table", async () => {
    mockCompareClips.mockResolvedValue(DEMO_REPORT);
    render(<AccuracyLabPanel />);
    screen.getByRole("button", { name: /Drop an MP4/ }).click();
    await screen.findByText("browser-demo.mp4");
    screen.getByRole("button", { name: "Compare configs" }).click();

    await waitFor(() => {
      expect(screen.getByText("Configuration")).toBeInTheDocument();
    });
    expect(screen.getByText("demo + demo")).toBeInTheDocument();
    expect(screen.getByText("demo+demo")).toBeInTheDocument();
  });

  it("is content-free in the default export", async () => {
    mockCompareClips.mockResolvedValue(DEMO_REPORT);
    render(<AccuracyLabPanel />);
    screen.getByRole("button", { name: /Drop an MP4/ }).click();
    await screen.findByText("browser-demo.mp4");
    screen.getByRole("button", { name: "Compare configs" }).click();
    await waitFor(() => {
      expect(screen.getByText("Configuration")).toBeInTheDocument();
    });
    expect(screen.queryByText(/kumusta/)).not.toBeInTheDocument();
  });
});
