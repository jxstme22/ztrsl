import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsPanel } from "./DiagnosticsPanel";
import {
  type DiagnosticsSnapshot,
  EMPTY_DIAGNOSTICS,
} from "../diagnostics/model";
import { DEFAULT_OVERLAY_SETTINGS } from "../overlay/model";

const SNAPSHOT: DiagnosticsSnapshot = {
  ...EMPTY_DIAGNOSTICS,
  capturedAtMs: 1234,
  sources: [
    {
      sourceId: "11111111111111111111111111111111",
      active: true,
      openUtteranceSamples: 0,
      utteranceSequence: 3,
      packetsReceived: 12,
      utterancesCompleted: 4,
      captionsEmitted: 4,
      lowConfidenceCaptions: 1,
      utterancesDropped: 0,
      filter: { applied: 4, suppressed: 1, flagged: 0, passed: 3, off: 0 },
    },
  ],
  scheduler: {
    finalsSubmitted: 4,
    provisionalsSubmitted: 2,
    finalsCompleted: 4,
    provisionalsCompleted: 2,
    provisionalsCoalesced: 1,
    provisionalsDropped: 0,
    finalsDropped: 0,
    overloadEvents: 0,
    queueDepth: 0,
    oldestQueuedMs: 0,
    avgQueueDelayMs: 12,
    maxQueueDelayMs: 40,
  },
  leakage: {
    passed: true,
    checkedAtMs: 1234,
    detail: "TEAM and DISCORD captions stayed isolated.",
  },
};

const SOURCE_CONFIGS = {
  schemaVersion: 3 as const,
  sources: [
    {
      sourceId: "11111111111111111111111111111111",
      displayName: "Team",
      captionTag: "TEAM",
      labelStyle: "brackets" as const,
      color: null,
      captureTarget: { kind: "endpoint" as const, endpointId: null },
      monitoring: { enabled: false, headphoneEndpointId: null, volume: 0.5 },
      languageProfile: "tagalog" as const,
      strictness: "balanced" as const,
    },
  ],
};

function renderPanel() {
  return render(
    <DiagnosticsPanel
      snapshot={SNAPSHOT}
      sourceConfigs={SOURCE_CONFIGS}
      overlaySettings={DEFAULT_OVERLAY_SETTINGS}
      appVersion="0.3.0"
      platform="test"
    />,
  );
}

describe("DiagnosticsPanel", () => {
  it("renders scheduler, per-source, and filter metrics from fake data", () => {
    renderPanel();
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
    expect(screen.getByText("Queue depth")).toBeInTheDocument();
    expect(screen.getByText("Suppressed")).toBeInTheDocument();
    expect(screen.getByText("TEAM")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("shows the isolation check result", () => {
    renderPanel();
    expect(screen.getByText("Clean")).toBeInTheDocument();
  });

  it("renders the empty state when no sources are active", () => {
    render(
      <DiagnosticsPanel
        snapshot={EMPTY_DIAGNOSTICS}
        sourceConfigs={null}
        overlaySettings={DEFAULT_OVERLAY_SETTINGS}
        appVersion="0.3.0"
        platform="test"
      />,
    );
    expect(screen.getByText(/No active sources/)).toBeInTheDocument();
  });

  it("exports a content-free support bundle on demand", () => {
    const onExport = vi.fn();
    render(
      <DiagnosticsPanel
        snapshot={SNAPSHOT}
        sourceConfigs={SOURCE_CONFIGS}
        overlaySettings={DEFAULT_OVERLAY_SETTINGS}
        appVersion="0.3.0"
        platform="test"
        onExport={onExport}
      />,
    );
    screen.getByRole("button", { name: "Export support bundle" }).click();
    expect(onExport).toHaveBeenCalledTimes(1);
    const json = onExport.mock.calls[0]?.[0] as string;
    expect(json).toMatch(/captionsEmitted/);
    expect(json).not.toMatch(/english_text|source_text/);
  });
});
