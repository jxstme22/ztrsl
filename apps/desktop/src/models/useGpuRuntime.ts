import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelGpuRuntimeInstall,
  deleteGpuRuntime,
  getGpuRuntimeStatus,
  installGpuRuntime,
  onGpuRuntimeProgress,
  revealPath,
} from "./bridge";
import {
  EMPTY_GPU_RUNTIME_STATUS,
  type GpuRuntimeProgress,
  type GpuRuntimeStatus,
} from "./model";

export type GpuRuntimeUiState = {
  status: GpuRuntimeStatus;
  /** Last progress event; `null` when idle. */
  progress: GpuRuntimeProgress | null;
  error: string | null;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  cancel: () => Promise<void>;
  remove: () => Promise<void>;
  isInstalling: boolean;
  /** Open the CUDA runtime folder in the system file manager. */
  revealPath: () => Promise<void>;
};

/**
 * State + actions for the optional CUDA runtime pack (opt-in GPU
 * acceleration). Downloads a pinned, checksum-verified set of NVIDIA cu12
 * wheels (~1.3 GB) and flattens their DLLs into the models dir for
 * `os.add_dll_directory`.
 */
export function useGpuRuntime(desktopOnly = true): GpuRuntimeUiState {
  const [status, setStatus] = useState<GpuRuntimeStatus>(
    EMPTY_GPU_RUNTIME_STATUS,
  );
  const [progress, setProgress] = useState<GpuRuntimeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setStatus(await getGpuRuntimeStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  refreshRef.current = () => {
    void refresh();
  };

  useEffect(() => {
    if (!desktopOnly) {
      return;
    }
    void refresh();
    return onGpuRuntimeProgress((event: GpuRuntimeProgress) => {
      setProgress(event);
      if (event.done) {
        refreshRef.current();
      }
    });
  }, [desktopOnly, refresh]);

  const install = useCallback(async () => {
    setError(null);
    setProgress(null);
    try {
      await installGpuRuntime();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const cancel = useCallback(async () => {
    setError(null);
    try {
      await cancelGpuRuntimeInstall();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const remove = useCallback(async () => {
    setError(null);
    try {
      await deleteGpuRuntime();
      setProgress(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refresh]);

  const reveal = useCallback(async () => {
    if (status.path === "") {
      return;
    }
    setError(null);
    try {
      await revealPath(status.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [status.path]);

  return {
    status,
    progress,
    error,
    refresh,
    install,
    cancel,
    remove,
    isInstalling: status.installing || (progress !== null && !progress.done),
    revealPath: reveal,
  };
}
