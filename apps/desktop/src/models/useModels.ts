import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addUserModel,
  cancelInstall,
  deleteModel,
  getDownloadEndpoint,
  getProviderStatus,
  importOfflinePack,
  installModel,
  installModelFromUrl,
  listModels,
  onInstallProgress,
  pickFolder,
  removeUserModel,
  revealPath,
  setDownloadEndpoint,
} from "./bridge";
import {
  EMPTY_MODELS_LIST,
  EMPTY_DOWNLOAD_ENDPOINT,
  EMPTY_PROVIDER_STATUS,
  type CatalogEntry,
  type DownloadEndpointInfo,
  type ModelInfo,
  type ModelProgress,
  type ModelsList,
  type ProviderStatus,
  type UserModelInput,
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
  /** v0.4: locally-exported models (NCSpeech) detected on disk. */
  knownInstalled: ModelInfo[];
  knownAvailable: ModelInfo[];
  /** v0.6.1: URL-imported models under custom ids. */
  custom: ModelInfo[];
  /** Effective Hugging Face download endpoint (mirror-aware). */
  downloadEndpoint: DownloadEndpointInfo;
  /** Persist a user-chosen download endpoint; "" resets to auto. */
  setDownloadEndpoint: (endpoint: string) => Promise<void>;
  /** Provider candidates + region for honest download status (Phase 9). */
  providerStatus: ProviderStatus;
  /** Import a verified offline model pack; resolves to imported ids. */
  importOfflinePack: (packDir: string) => Promise<string[]>;
  /** Download a known local-export model from an http(s) URL. */
  installFromUrl: (
    modelId: string,
    url: string,
    kind: string,
    runtime: string,
  ) => Promise<string>;
  /** Register a user-defined model; resolves to the created entry. */
  addUserModel: (input: UserModelInput) => Promise<CatalogEntry | null>;
  /** Remove a user-defined model definition (files stay on disk). */
  removeUserModel: (id: string) => Promise<void>;
  /** Open a native folder picker; null when the user cancels. */
  pickFolder: () => Promise<string | null>;
  /** Open a model folder in the system file manager. */
  revealPath: (path: string) => Promise<void>;
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
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(
    EMPTY_PROVIDER_STATUS,
  );
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

  const syncProviderStatus = useCallback(async () => {
    try {
      setProviderStatus(await getProviderStatus());
    } catch {
      setProviderStatus(EMPTY_PROVIDER_STATUS);
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
    void syncProviderStatus();
    void refresh();
    return onInstallProgress((event: ModelProgress) => {
      setProgress((previous) => ({ ...previous, [event.modelId]: event }));
      if (event.done) {
        refreshRef.current();
      }
    });
  }, [desktopOnly, refresh, syncDownloadEndpoint, syncProviderStatus]);

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

  const knownInstalled = useMemo(
    () => list.known.filter((model) => model.status === "installed"),
    [list.known],
  );

  const knownAvailable = useMemo(
    () => list.known.filter((model) => model.status !== "installed"),
    [list.known],
  );

  const available = useMemo(
    () =>
      list.models
        .filter((model) => model.status !== "installed")
        .sort((a, b) => (SORT_ORDER[a.id] ?? 99) - (SORT_ORDER[b.id] ?? 99)),
    [list.models],
  );

  const importOffline = useCallback(
    async (packDir: string) => {
      setError(null);
      try {
        const imported = await importOfflinePack(packDir);
        await refresh();
        return imported;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return [];
      }
    },
    [refresh],
  );

  const installFromUrl = useCallback(
    async (modelId: string, url: string, kind: string, runtime: string) => {
      setError(null);
      try {
        const installedId = await installModelFromUrl(
          modelId,
          url,
          kind,
          runtime,
        );
        await refresh();
        return installedId;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [refresh],
  );

  const addUserModelEntry = useCallback(
    async (input: UserModelInput) => {
      setError(null);
      try {
        const created = await addUserModel(input);
        await refresh();
        return created;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [refresh],
  );

  const removeUserModelEntry = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await removeUserModel(id);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refresh],
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
    knownInstalled,
    knownAvailable,
    custom: list.custom,
    downloadEndpoint,
    setDownloadEndpoint: updateDownloadEndpoint,
    providerStatus,
    importOfflinePack: importOffline,
    installFromUrl,
    addUserModel: addUserModelEntry,
    removeUserModel: removeUserModelEntry,
    pickFolder,
    revealPath,
  };
}
