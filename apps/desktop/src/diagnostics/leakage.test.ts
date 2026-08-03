import { describe, expect, it } from "vitest";

import { classifyLeakage } from "./leakage";

const TEAM = "11111111111111111111111111111111";
const DISCORD = "22222222222222222222222222222222";

function finalCaption(sourceId: string, tag: string): Parameters<typeof classifyLeakage>[0][number] {
  return {
    protocol_version: 2,
    message_id: "c",
    session_id: "s",
    type: "caption.final",
    sent_monotonic_ns: 1,
    payload: {
      caption_id: `c-${sourceId}`,
      utterance_id: "u",
      revision: 1,
      status: "final",
      source_mode: "filipino",
      source_text: "x",
      english_text: "y",
      started_monotonic_ns: 0,
      ended_monotonic_ns: 1,
      capture_to_caption_ms: 0,
      asr_ms: 0,
      translation_ms: 0,
      confidence: 0.9,
      warnings: [],
      source_id: sourceId,
      source_snapshot: {
        display_name: "S",
        caption_tag: tag,
        label_style: "brackets",
        color: null,
      },
    },
  };
}

describe("classifyLeakage", () => {
  it("passes when two sources produce isolated captions", () => {
    const report = classifyLeakage([
      finalCaption(TEAM, "TEAM"),
      finalCaption(DISCORD, "DISCORD"),
    ]);
    expect(report.passed).toBe(true);
    expect(report.detail).toMatch(/no cross-source leakage/i);
  });

  it("fails when a caption has no source id", () => {
    const report = classifyLeakage([
      finalCaption(TEAM, "TEAM"),
      { ...finalCaption(DISCORD, "DISCORD"), payload: { ...finalCaption(DISCORD, "DISCORD").payload, source_id: undefined } },
    ]);
    expect(report.passed).toBe(false);
    expect(report.detail).toMatch(/missing a source id/i);
  });

  it("fails when there is only one distinct source", () => {
    const report = classifyLeakage([
      finalCaption(TEAM, "TEAM"),
      finalCaption(TEAM, "TEAM"),
    ]);
    expect(report.passed).toBe(false);
    expect(report.detail).toMatch(/distinct source/i);
  });

  it("fails when no final captions exist", () => {
    const report = classifyLeakage([]);
    expect(report.passed).toBe(false);
    expect(report.detail).toMatch(/No finalized captions/i);
  });
});
