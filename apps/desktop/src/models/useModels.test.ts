import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as bridge from "./bridge";
import { useModels } from "./useModels";

vi.mock("./bridge", () => ({
  listModels: vi.fn(),
  installModel: vi.fn(),
  cancelInstall: vi.fn(),
  deleteModel: vi.fn(),
  onInstallProgress: vi.fn(),
}));

const mocked = vi.mocked(bridge);

const AVAILABLE = {
  models: [
    {
      id: "whisper-large-v3-turbo",
      name: "Whisper Turbo",
      kind: "asr" as const,
      runtime: "faster-whisper",
      recommended: true,
      description: "d",
      licenseSpdx: "MIT",
      licenseNotice: "",
      downloadSizeBytes: 10,
      source: "s",
      revision: "r",
      fileCount: 1,
      status: "available" as const,
      installedSizeBytes: 0,
    },
    {
      id: "nllb-200-distilled-600M-ct2-int8",
      name: "NLLB",
      kind: "translation" as const,
      runtime: "ctranslate2",
      recommended: true,
      description: "d",
      licenseSpdx: "CC-BY-NC-4.0",
      licenseNotice: "non-commercial",
      downloadSizeBytes: 20,
      source: "s",
      revision: "r",
      fileCount: 1,
      status: "available" as const,
      installedSizeBytes: 0,
    },
  ],
  inUse: [],
};

describe("useModels", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the catalog and exposes installed vs available", async () => {
    mocked.listModels.mockResolvedValue(AVAILABLE);
    mocked.onInstallProgress.mockReturnValue(() => undefined);
    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.available).toHaveLength(2);
    expect(result.current.installed).toHaveLength(0);
    expect(result.current.hasInstalledModels).toBe(false);
  });

  it("tracks progress and refreshes once an install finishes", async () => {
    let handler: ((event: unknown) => void) | undefined;
    mocked.listModels.mockResolvedValue(AVAILABLE);
    mocked.onInstallProgress.mockImplementation((cb) => {
      handler = cb as (event: unknown) => void;
      return () => undefined;
    });
    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    act(() => {
      handler?.({
        modelId: "whisper-large-v3-turbo",
        done: false,
        canceled: false,
        error: null,
        phase: "download",
        fileIndex: 0,
        fileCount: 1,
        fileBytesDone: 5,
        fileBytesTotal: 10,
        totalBytesDone: 5,
        totalBytesTotal: 10,
      });
    });
    expect(result.current.isInstalling("whisper-large-v3-turbo")).toBe(true);

    mocked.listModels.mockResolvedValue({
      models: [
        {
          id: "whisper-large-v3-turbo",
          name: "Whisper Turbo",
          kind: "asr",
          runtime: "faster-whisper",
          recommended: true,
          description: "d",
          licenseSpdx: "MIT",
          licenseNotice: "",
          downloadSizeBytes: 10,
          source: "s",
          revision: "r",
          fileCount: 1,
          status: "installed",
          installedSizeBytes: 10,
        },
        {
          id: "nllb-200-distilled-600M-ct2-int8",
          name: "NLLB",
          kind: "translation",
          runtime: "ctranslate2",
          recommended: true,
          description: "d",
          licenseSpdx: "CC-BY-NC-4.0",
          licenseNotice: "non-commercial",
          downloadSizeBytes: 20,
          source: "s",
          revision: "r",
          fileCount: 1,
          status: "available",
          installedSizeBytes: 0,
        },
      ],
      inUse: [],
    });
    act(() => {
      handler?.({
        modelId: "whisper-large-v3-turbo",
        done: true,
        canceled: false,
        error: null,
        phase: "done",
        fileIndex: 0,
        fileCount: 0,
        fileBytesDone: 0,
        fileBytesTotal: 0,
        totalBytesDone: 0,
        totalBytesTotal: 0,
      });
    });
    await waitFor(() => {
      expect(result.current.hasInstalledModels).toBe(true);
    });
    expect(result.current.isInstalling("whisper-large-v3-turbo")).toBe(false);
  });

  it("surfaces install errors without losing the list", async () => {
    mocked.listModels.mockResolvedValue(AVAILABLE);
    mocked.installModel.mockRejectedValue(new Error("already installing"));
    mocked.onInstallProgress.mockReturnValue(() => undefined);
    const { result } = renderHook(() => useModels());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    await act(async () => {
      await result.current.startInstall("whisper-large-v3-turbo");
    });
    expect(result.current.error).toBe("already installing");
  });
});
