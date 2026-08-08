import type { HistoryEntry } from "./history";

/**
 * DS-901: transcript export. One format per function; every exporter is
 * pure, UTF-8, chronologically ordered, and skips provisional captions
 * (history only ever holds finals). Source labels are explicit; the
 * `includeSource` flag adds the transcribed input line.
 */

export type ExportOptions = {
  includeSource?: boolean;
  lineSeparator?: string;
};

function timestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function srtTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function exportTxt(entries: HistoryEntry[], options: ExportOptions = {}): string {
  const { includeSource = false, lineSeparator = "\n" } = options;
  return entries
    .map((entry) => {
      const who = entry.displayName || entry.sourceLabel || "?";
      const lines = [`[${timestamp(entry.timestampMs)}] ${who}: ${entry.text}`];
      if (includeSource && entry.sourceText !== "") {
        lines.push(`  (${entry.sourceText})`);
      }
      return lines.join(lineSeparator);
    })
    .join(`${lineSeparator}${lineSeparator}`);
}

export function exportJson(entries: HistoryEntry[], options: ExportOptions = {}): string {
  const { includeSource = false } = options;
  return JSON.stringify(
    {
      exportedAtMs: Date.now(),
      entries: entries.map((entry) => ({
        time: timestamp(entry.timestampMs),
        speaker: entry.displayName || entry.sourceLabel || "",
        text: entry.text,
        ...(includeSource && entry.sourceText !== ""
          ? { sourceText: entry.sourceText }
          : {}),
        uncertain: entry.uncertain,
      })),
    },
    null,
    2,
  );
}

export function exportSrt(entries: HistoryEntry[], options: ExportOptions = {}): string {
  const { includeSource = false, lineSeparator = "\n" } = options;
  const seconds = (index: number): number => entries[index]?.timestampMs ?? 0;
  return entries
    .map((entry, index) => {
      const start = srtTimestamp(seconds(index));
      const end = srtTimestamp(seconds(index + 1) || seconds(index) + 2000);
      const text = includeSource && entry.sourceText !== ""
        ? `${entry.text}\n(${entry.sourceText})`
        : entry.text;
      return [
        String(index + 1),
        `${start} --> ${end}`,
        text,
      ].join(lineSeparator);
    })
    .join(`${lineSeparator}${lineSeparator}`);
}

export function exportVtt(entries: HistoryEntry[], options: ExportOptions = {}): string {
  const { includeSource = false, lineSeparator = "\n" } = options;
  const body = entries
    .map((entry, index) => {
      const start = srtTimestamp(entry.timestampMs);
      const end = srtTimestamp(entries[index + 1]?.timestampMs ?? entry.timestampMs + 2000);
      const text = includeSource && entry.sourceText !== ""
        ? `${entry.text}\n(${entry.sourceText})`
        : entry.text;
      return `${start} --> ${end}\n${text}`;
    })
    .join(`${lineSeparator}${lineSeparator}`);
  return `WEBVTT${lineSeparator}${body}`;
}

export function exportMarkdown(entries: HistoryEntry[], options: ExportOptions = {}): string {
  const { includeSource = false, lineSeparator = "\n" } = options;
  return entries
    .map((entry) => {
      const who = entry.displayName || entry.sourceLabel || "Unknown";
      const lines = [`**${timestamp(entry.timestampMs)} — ${who}:** ${entry.text}`];
      if (includeSource && entry.sourceText !== "") {
        lines.push(`> ${entry.sourceText}`);
      }
      return lines.join(lineSeparator);
    })
    .join(`${lineSeparator}${lineSeparator}`);
}

export const EXPORT_FORMATS = [
  "txt",
  "json",
  "srt",
  "vtt",
  "markdown",
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function exportTranscript(
  format: ExportFormat,
  entries: HistoryEntry[],
  options: ExportOptions = {},
): string {
  switch (format) {
    case "txt":
      return exportTxt(entries, options);
    case "json":
      return exportJson(entries, options);
    case "srt":
      return exportSrt(entries, options);
    case "vtt":
      return exportVtt(entries, options);
    case "markdown":
      return exportMarkdown(entries, options);
  }
}
