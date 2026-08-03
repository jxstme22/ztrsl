import { describe, expect, it } from "vitest";

import { buildSupportBundle, serializeContentFree } from "./supportBundle";
import { EMPTY_DIAGNOSTICS, type DiagnosticsSnapshot } from "./model";
import type { SourceConfigs } from "../sources/model";
import { DEFAULT_OVERLAY_SETTINGS } from "../overlay/model";

const SOURCE_CONFIGS: SourceConfigs = {
  schemaVersion: 3,
  sources: [
    {
      sourceId: "11111111111111111111111111111111",
      displayName: "Team",
      captionTag: "TEAM",
      labelStyle: "brackets",
      captionAlignment: "center",
      color: null,
      captureTarget: { kind: "endpoint", endpointId: null },
      monitoring: { enabled: false, headphoneEndpointId: null, volume: 0.5 },
      languageProfile: "tagalog",
      strictness: "balanced",
    },
  ],
};

function snapshot(): DiagnosticsSnapshot {
  return {
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
  };
}

describe("buildSupportBundle", () => {
  it("includes metrics and config but never transcripts", () => {
    const bundle = buildSupportBundle({
      appVersion: "0.3.0",
      platform: "darwin",
      diagnostics: snapshot(),
      sourceConfigs: SOURCE_CONFIGS,
      overlaySettings: DEFAULT_OVERLAY_SETTINGS,
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.diagnostics.sources).toHaveLength(1);
    expect(bundle.sourceConfigs[0]?.captionTag).toBe("TEAM");
    expect(bundle.sourceConfigs[0]?.languageProfile).toBe("tagalog");
    expect(bundle.overlaySettings.simultaneousPolicy).toBe("show-both");
  });

  it("serializes without leaking transcript keys", () => {
    const bundle = buildSupportBundle({
      appVersion: "0.3.0",
      platform: "darwin",
      diagnostics: snapshot(),
      sourceConfigs: SOURCE_CONFIGS,
      overlaySettings: DEFAULT_OVERLAY_SETTINGS,
    });

    const serialized = serializeContentFree(bundle);
    expect(serialized).not.toMatch(/english_text|englishText|source_text/);
    expect(serialized).toMatch(/captionsEmitted/);
  });

  it("handles a missing source configs document", () => {
    const bundle = buildSupportBundle({
      appVersion: "0.3.0",
      platform: "darwin",
      diagnostics: EMPTY_DIAGNOSTICS,
      sourceConfigs: null,
      overlaySettings: DEFAULT_OVERLAY_SETTINGS,
    });
    expect(bundle.sourceConfigs).toEqual([]);
    expect(() => serializeContentFree(bundle)).not.toThrow();
  });

  it("refuses to serialize when a transcript key is present (regression guard)", () => {
    const leaked = {
      ...EMPTY_DIAGNOSTICS,
      sources: [
        {
          sourceId: "11111111111111111111111111111111",
          active: true,
          openUtteranceSamples: 0,
          utteranceSequence: 0,
          packetsReceived: 0,
          utterancesCompleted: 0,
          captionsEmitted: 0,
          lowConfidenceCaptions: 0,
          utterancesDropped: 0,
          // A malicious/corrupted diagnostics payload carrying transcript text.
          source_text: "secret transcript",
        },
      ],
    };

    const bundle = buildSupportBundle({
      appVersion: "0.3.0",
      platform: "darwin",
      diagnostics: leaked,
      sourceConfigs: SOURCE_CONFIGS,
      overlaySettings: DEFAULT_OVERLAY_SETTINGS,
    });

    expect(() => serializeContentFree(bundle)).toThrow(
      /transcript leak|english_text|source_text/,
    );
  });
});
