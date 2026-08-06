import { describe, expect, it } from "vitest";

import { ModelsPanel, formatBytes } from "../components/ModelsPanel";
import {
  gpuRuntimeStatusSchema,
  modelsListSchema,
  modelProgressSchema,
} from "./model";

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
          modelDir:
            "C:\\Users\\me\\AppData\\Roaming\\app.localsquadtranslator.desktop\\models\\whisper-large-v3-turbo",
        },
      ],
      inUse: ["whisper-large-v3-turbo"],
    });
    expect(result.models[0]?.kind).toBe("asr");
    expect(result.models[0]?.status).toBe("installed");
    expect(result.models[0]?.modelDir).toMatch(/whisper-large-v3-turbo$/);
    expect(result.inUse).toContain("whisper-large-v3-turbo");
    expect(result.known).toEqual([]);
  });

  it("parses known local-export models (NCSpeech)", () => {
    const result = modelsListSchema.parse({
      models: [],
      inUse: [],
      known: [
        {
          id: "ncspeech-tl-fastconformer-hybrid-large",
          name: "NCSpeech Tagalog (CTC)",
          kind: "asr",
          runtime: "sherpa-onnx",
          recommended: false,
          description: "Fixed-language Tagalog (local NeMo export)",
          licenseSpdx: "CC-BY-4.0",
          licenseNotice: "local export",
          downloadSizeBytes: 0,
          source: "local-export",
          revision: "export",
          fileCount: 0,
          capabilities: {
            languageCapability: "forced",
            recommendedProfiles: [],
            vramClass: "low",
          },
          status: "installed",
          installedSizeBytes: 0,
          modelDir: "",
        },
      ],
    });
    expect(result.known).toHaveLength(1);
    expect(result.known[0]?.capabilities.languageCapability).toBe("forced");
    expect(result.known[0]?.status).toBe("installed");
  });

  it("parses the CUDA runtime status including its on-disk path", () => {
    const result = gpuRuntimeStatusSchema.parse({
      installed: true,
      installing: false,
      installedSizeBytes: 42,
      downloadSizeBytes: 0,
      systemAvailable: true,
      hasArtifacts: true,
      path: "C:\\Users\\me\\AppData\\Roaming\\app.localsquadtranslator.desktop\\cuda\\cu12",
      wheels: [{ package: "cuBLAS", sizeBytes: 60 }],
    });
    expect(result.path).toMatch(/cu12$/);
    expect(result.hasArtifacts).toBe(true);
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
            modelDir: "",
          },
        ],
        inUse: [],
      }),
    ).toThrow();
  });

  it("keeps the list parseable when a custom model carries a stale capability value", () => {
    // v0.6.11 and earlier serialized URL-imported custom models with
    // languageCapability "unknown", which bricked the entire Models page
    // for any machine with a custom model installed. The schema must fall
    // back instead of failing the whole list.
    const result = modelsListSchema.parse({
      models: [],
      inUse: [],
      custom: [
        {
          id: "my-custom-model",
          name: "my-custom-model",
          kind: "asr",
          runtime: "custom",
          recommended: false,
          description: "installed from URL",
          licenseSpdx: "unknown",
          licenseNotice: "",
          downloadSizeBytes: 123,
          source: "https://example.com/model.zip",
          revision: "2026-01-01",
          fileCount: 2,
          capabilities: {
            languageCapability: "unknown",
            recommendedProfiles: [],
            vramClass: "unknown",
          },
          status: "installed",
          installedSizeBytes: 123,
          modelDir: "C:\\models\\my-custom-model",
        },
      ],
    });
    expect(result.custom).toHaveLength(1);
    expect(result.custom[0]?.capabilities.languageCapability).toBe(
      "post-filter",
    );
    expect(result.custom[0]?.capabilities.vramClass).toBe("low");
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
