import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelInstall,
  deleteModel,
  getDownloadEndpoint,
  installModel,
  listModels,
  onInstallProgress,
  setDownloadEndpoint,
} from "./bridge";
import {
  EMPTY_MODELS_LIST,
  EMPTY_DOWNLOAD_ENDPOINT,
  type DownloadEndpointInfo,
  type ModelInfo,
  type ModelProgress,
  type ModelsList,
} from "./model";
import { loadModelsSettings, saveModelsSettings } from "./storage";

export type ModelUiState = {
  list: ModelsList;
  loading: boolean;
  /** modelId -> last progress event (finished installs keep a `done` event). */
  progress: Record<string, ModelProgress>;
  error: string | null;
  refresh: () => Promise<void>;
  startInstall: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  hasInstalledModels: boolean;
  isInstalling: (id: string) => boolean;
  installed: ModelInfo[];
  available: ModelInfo[];
  /** Effective Hugging Face download endpoint (mirror-aware). */
  downloadEndpoint: DownloadEndpointInfo;
  /** Persist a user-chosen download endpoint; "" resets to auto. */
  setDownloadEndpoint: (endpoint: string) => Promise<void>;
};

const SORT_ORDER: Record<string, number> = {
  "whisper-large-v3-turbo": 0,
  "nllb-200-distilled-600M-ct2-int8": 1,
  "whisper-large-v3": 2,
  "omni-ctc-300m-int8": 3,
  "madlad400-3b-mt": 4,
};

export function useModels(desktopOnly = true): ModelUiState {
  const [list, setList] = useState<ModelsList>(EMPTY_MODELS_LIST);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const [downloadEndpoint, setDownloadEndpointState] =
    useState<DownloadEndpointInfo>(EMPTY_DOWNLOAD_ENDPOINT);
  const refreshRef = useRef<() => void>(() => undefined);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setList(await listModels());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const syncDownloadEndpoint = useCallback(async () => {
    try {
      setDownloadEndpointState(await getDownloadEndpoint());
    } catch {
      setDownloadEndpointState(EMPTY_DOWNLOAD_ENDPOINT);
    }
  }, []);

  const updateDownloadEndpoint = useCallback(async (endpoint: string) => {
    const trimmed = endpoint.trim().replace(/\/+$/, "");
    saveModelsSettings({ hfEndpoint: trimmed === "" ? null : trimmed });
    setError(null);
    try {
      setDownloadEndpointState(await setDownloadEndpoint(trimmed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  refreshRef.current = () => {
    void refresh();
  };

  useEffect(() => {
    if (!desktopOnly) {
      setLoading(false);
      return;
    }
    const saved = loadModelsSettings();
    if (saved.hfEndpoint !== null) {
      // Reapply the saved mirror; on failure fall back to the auto endpoint.
      void setDownloadEndpoint(saved.hfEndpoint).then(
        syncDownloadEndpoint,
        syncDownloadEndpoint,
      );
    } else {
      void syncDownloadEndpoint();
    }
    void refresh();
    return onInstallProgress((event: ModelProgress) => {
      setProgress((previous) => ({ ...previous, [event.modelId]: event }));
      if (event.done) {
        refreshRef.current();
      }
    });
  }, [desktopOnly, refresh, syncDownloadEndpoint]);

  const startInstall = useCallback(async (id: string) => {
    setError(null);
    try {
      await installModel(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const cancel = useCallback(async (id: string) => {
    setError(null);
    try {
      await cancelInstall(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteModel(id);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refresh],
  );

  const isInstalling = useCallback(
    (id: string) => progress[id] !== undefined && !progress[id].done,
    [progress],
  );

  const installed = useMemo(
    () =>
      list.models
        .filter((model) => model.status === "installed")
        .sort((a, b) => (SORT_ORDER[a.id] ?? 99) - (SORT_ORDER[b.id] ?? 99)),
    [list.models],
  );

  const available = useMemo(
    () =>
      list.models
        .filter((model) => model.status !== "installed")
        .sort((a, b) => (SORT_ORDER[a.id] ?? 99) - (SORT_ORDER[b.id] ?? 99)),
    [list.models],
  );

  return {
    list,
    loading,
    progress,
    error,
    refresh,
    startInstall,
    cancel,
    remove,
    hasInstalledModels: installed.length > 0,
    isInstalling,
    installed,
    available,
    downloadEndpoint,
    setDownloadEndpoint: updateDownloadEndpoint,
  };
}
