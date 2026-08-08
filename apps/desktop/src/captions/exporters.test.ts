import { describe, expect, it } from "vitest";

import type { HistoryEntry } from "./history";
import {
  exportJson,
  exportMarkdown,
  exportSrt,
  exportTxt,
  exportVtt,
} from "./exporters";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "c1",
    text: "Say it",
    sourceText: "sabihin mo",
    sourceLabel: "TEAM",
    sourceId: "",
    displayName: "Team",
    color: "",
    audioSource: "",
    timestampMs: 1_000,
    uncertain: false,
    startedAtMs: 1_000,
    status: "final",
    confidenceCategory: "high",
    provider: "",
    detectedLanguage: "",
    warnings: [],
    preset: "",
    latencyMs: 0,
    sessionId: "",
    fromSelf: false,
    ...overrides,
  };
}

describe("transcript exporters (DS-901)", () => {
  const entries = [entry(), entry({ id: "c2", text: "Rotate B", sourceText: "paikutin B", timestampMs: 5_000 })];

  it("exports txt in chronological order with explicit speakers", () => {
    const text = exportTxt(entries);
    expect(text).toContain("Team: Say it");
    expect(text).toContain("Team: Rotate B");
    expect(text.indexOf("Say it")).toBeLessThan(text.indexOf("Rotate B"));
  });

  it("includes the transcribed input when requested", () => {
    const text = exportTxt(entries, { includeSource: true });
    expect(text).toContain("sabihin mo");
    expect(text).toContain("paikutin B");
  });

  it("exports json without provisional captions", () => {
    const parsed = JSON.parse(exportJson(entries)) as {
      entries: { text: string }[];
    };
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.text).toBe("Say it");
  });

  it("exports srt with sequential cues", () => {
    const srt = exportSrt(entries);
    expect(srt).toMatch(/^1\n/);
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
    expect(srt).toContain("Say it");
    expect(srt).toContain("Rotate B");
  });

  it("exports vtt with the WEBVTT header", () => {
    const vtt = exportVtt(entries);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("-->");
  });

  it("exports markdown with speakers", () => {
    const md = exportMarkdown(entries);
    expect(md).toMatch(/\*\*\d{2}:\d{2}:\d{2} — Team:\*\* Say it/);
    expect(md).not.toContain("sabihin mo");
  });
});
