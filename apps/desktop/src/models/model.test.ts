import { describe, expect, it } from "vitest";

import { ModelsPanel, formatBytes } from "../components/ModelsPanel";
import { modelsListSchema, modelProgressSchema } from "./model";

describe("models schemas", () => {
  it("parses the catalog list from the Rust command", () => {
    const result = modelsListSchema.parse({
      models: [
        {
          id: "whisper-large-v3-turbo",
          name: "Whisper Turbo (recommended)",
          kind: "asr",
          runtime: "faster-whisper",
          recommended: true,
          description: "desc",
          licenseSpdx: "MIT",
          licenseNotice: "",
          downloadSizeBytes: 1621665983,
          source:
            "https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo",
          revision: "0a363e9",
          fileCount: 5,
          capabilities: {
            languageCapability: "post-filter",
            recommendedProfiles: [],
            vramClass: "medium",
          },
          status: "installed",
          installedSizeBytes: 1621665983,
        },
      ],
      inUse: ["whisper-large-v3-turbo"],
    });
    expect(result.models[0]?.kind).toBe("asr");
    expect(result.models[0]?.status).toBe("installed");
    expect(result.inUse).toContain("whisper-large-v3-turbo");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      modelsListSchema.parse({
        models: [
          {
            id: "x",
            name: "x",
            kind: "asr",
            runtime: "r",
            recommended: false,
            description: "d",
            licenseSpdx: "MIT",
            licenseNotice: "",
            downloadSizeBytes: 1,
            source: "s",
            revision: "r",
            fileCount: 1,
            status: "broken",
            installedSizeBytes: 0,
          },
        ],
        inUse: [],
      }),
    ).toThrow();
  });

  it("parses progress events including completion errors", () => {
    const downloading = modelProgressSchema.parse({
      modelId: "nllb-200-distilled-600M-ct2-int8",
      done: false,
      canceled: false,
      error: null,
      phase: "download",
      fileIndex: 2,
      fileCount: 4,
      fileBytesDone: 100,
      fileBytesTotal: 1000,
      totalBytesDone: 300,
      totalBytesTotal: 4000,
    });
    expect(downloading.phase).toBe("download");
    expect(downloading.done).toBe(false);

    const failed = modelProgressSchema.parse({
      modelId: "x",
      done: true,
      canceled: false,
      error: "checksum mismatch",
      phase: "done",
      fileIndex: 0,
      fileCount: 0,
      fileBytesDone: 0,
      fileBytesTotal: 0,
      totalBytesDone: 0,
      totalBytesTotal: 0,
    });
    expect(failed.error).toBe("checksum mismatch");
  });
});

describe("formatBytes", () => {
  it("formats sizes for the confirmation dialogs", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(645849522)).toBe("616 MB");
    expect(formatBytes(1621665983)).toMatch(/^1\.5\d GB$/);
  });
});

describe("ModelsPanel", () => {
  it("exports the panel component expected by ControlApp", () => {
    expect(typeof ModelsPanel).toBe("function");
  });
});
