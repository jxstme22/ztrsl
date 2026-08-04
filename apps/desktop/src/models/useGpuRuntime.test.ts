import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as bridge from "./bridge";
import { useGpuRuntime } from "./useGpuRuntime";

vi.mock("./bridge", () => ({
  getGpuRuntimeStatus: vi.fn(),
  installGpuRuntime: vi.fn(),
  cancelGpuRuntimeInstall: vi.fn(),
  deleteGpuRuntime: vi.fn(),
  onGpuRuntimeProgress: vi.fn(),
  revealPath: vi.fn(),
}));

const mocked = vi.mocked(bridge);

const INSTALLED = {
  installed: true,
  installing: false,
  installedSizeBytes: 42,
  downloadSizeBytes: 100,
  systemAvailable: true,
  hasArtifacts: true,
  path: "C:\\cuda\\12",
  wheels: [{ package: "cuBLAS", sizeBytes: 60 }],
};

const EMPTY = {
  installed: false,
  installing: false,
  installedSizeBytes: 0,
  downloadSizeBytes: 0,
  systemAvailable: false,
  hasArtifacts: false,
  path: "",
  wheels: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGpuRuntime", () => {
  it("loads the current status on mount", async () => {
    mocked.getGpuRuntimeStatus.mockResolvedValue(INSTALLED);
    mocked.onGpuRuntimeProgress.mockReturnValue(() => undefined);
    const { result } = renderHook(() => useGpuRuntime());
    await waitFor(() => {
      expect(result.current.status.installed).toBe(true);
    });
    expect(result.current.isInstalling).toBe(false);
  });

  it("drives an install and reflects the in-flight progress", async () => {
    mocked.getGpuRuntimeStatus.mockResolvedValue(EMPTY);
    mocked.onGpuRuntimeProgress.mockReturnValue(() => undefined);
    mocked.installGpuRuntime.mockResolvedValue(undefined);
    const { result } = renderHook(() => useGpuRuntime());
    await waitFor(() => {
      expect(result.current.status.installed).toBe(false);
    });

    act(() => {
      void result.current.install();
    });
    expect(mocked.installGpuRuntime).toHaveBeenCalledOnce();

    const progressHandler = mocked.onGpuRuntimeProgress.mock.calls[0]?.[0];
    act(() => {
      progressHandler?.({
        done: false,
        canceled: false,
        error: null,
        phase: "download",
        fileIndex: 0,
        fileCount: 1,
        fileBytesDone: 0,
        fileBytesTotal: 0,
        totalBytesDone: 10,
        totalBytesTotal: 100,
      });
    });
    expect(result.current.progress?.totalBytesDone).toBe(10);
  });

  it("removes an installed pack", async () => {
    mocked.getGpuRuntimeStatus.mockResolvedValue(INSTALLED);
    mocked.onGpuRuntimeProgress.mockReturnValue(() => undefined);
    mocked.deleteGpuRuntime.mockResolvedValue(undefined);
    const { result } = renderHook(() => useGpuRuntime());
    await waitFor(() => {
      expect(result.current.status.installed).toBe(true);
    });

    act(() => {
      void result.current.remove();
    });
    expect(mocked.deleteGpuRuntime).toHaveBeenCalledOnce();
  });
});
