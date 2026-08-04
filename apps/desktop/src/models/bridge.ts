import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { open as pickFolderDialog } from "@tauri-apps/plugin-dialog";
import { z } from "zod";

import {
  EMPTY_GPU_RUNTIME_STATUS,
  EMPTY_MODELS_LIST,
  EMPTY_PROVIDER_STATUS,
  downloadEndpointSchema,
  gpuRuntimeProgressSchema,
  gpuRuntimeStatusSchema,
  modelsListSchema,
  modelProgressSchema,
  providerStatusSchema,
  type DownloadEndpointInfo,
  type GpuRuntimeProgress,
  type GpuRuntimeStatus,
  type ModelsList,
  type ModelProgress,
  type ProviderStatus,
} from "./model";

export type ProgressHandler = (event: ModelProgress) => void;

/** Current effective Hugging Face endpoint (mirror-aware). */
export async function getDownloadEndpoint(): Promise<DownloadEndpointInfo> {
  if (!isTauri()) {
    return {
      endpoint: "https://huggingface.co",
      mirror: false,
      userOverride: false,
    };
  }
  return downloadEndpointSchema.parse(await invoke("models_download_endpoint"));
}

/** Provider candidates + region for honest download status (Phase 9). */
export async function getProviderStatus(): Promise<ProviderStatus> {
  if (!isTauri()) {
    return EMPTY_PROVIDER_STATUS;
  }
  return providerStatusSchema.parse(await invoke("models_providers"));
}

/** Import a verified offline model pack without any network. */
export async function importOfflinePack(packDir: string): Promise<string[]> {
  if (!isTauri()) {
    return [];
  }
  return z
    .array(z.string())
    .parse(await invoke("models_import_offline_pack", { packDir }));
}

/**
 * Ask the user to pick a folder (used for the offline pack import).
 * Returns the absolute path, or null when the user cancels.
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const picked = await pickFolderDialog({ directory: true, multiple: false });
  if (picked == null || Array.isArray(picked)) {
    return null;
  }
  return picked;
}

/** Open a model/runtime folder in the system file manager. */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("reveal_path", { path });
}

/** Persist a user-chosen download endpoint; empty string resets to auto. */
export async function setDownloadEndpoint(
  endpoint: string,
): Promise<DownloadEndpointInfo> {
  if (!isTauri()) {
    return {
      endpoint: "https://huggingface.co",
      mirror: false,
      userOverride: false,
    };
  }
  return downloadEndpointSchema.parse(
    await invoke("models_set_download_endpoint", { endpoint }),
  );
}

export async function listModels(): Promise<ModelsList> {
  if (!isTauri()) {
    return EMPTY_MODELS_LIST;
  }
  return modelsListSchema.parse(await invoke("models_list"));
}

/** Start installing `id`; completion/error arrives via `onInstallProgress`. */
export async function installModel(modelId: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("models_install", { id: modelId });
}

/** Download and install a model from an http(s) URL. When the URL serves an
 * offline-pack archive with a manifest, `id`/`kind`/`runtime` may be empty
 * (the manifest wins); otherwise all three are required. */
export async function installModelFromUrl(
  modelId: string,
  url: string,
  kind: string,
  runtime: string,
): Promise<string> {
  if (!isTauri()) {
    return modelId;
  }
  return await invoke("models_install_from_url", {
    id: modelId,
    url,
    kind,
    runtime,
  });
}

export async function cancelInstall(modelId: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("models_cancel_install", { id: modelId });
}

export async function deleteModel(modelId: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("models_delete", { id: modelId });
}

/**
 * Subscribe to install progress. Returns an unsubscribe function. Only
 * active in the Tauri runtime.
 */
export function onInstallProgress(handler: ProgressHandler): () => void {
  if (!isTauri()) {
    return () => undefined;
  }
  const unlisten = listen("models://progress", (event) => {
    handler(modelProgressSchema.parse(event.payload));
  });
  return () => {
    void unlisten.then((stop) => {
      stop();
    });
  };
}

export type GpuRuntimeProgressHandler = (event: GpuRuntimeProgress) => void;

/** Current CUDA runtime pack state (opt-in GPU acceleration). */
export async function getGpuRuntimeStatus(): Promise<GpuRuntimeStatus> {
  if (!isTauri()) {
    return EMPTY_GPU_RUNTIME_STATUS;
  }
  return gpuRuntimeStatusSchema.parse(await invoke("gpu_runtime_status"));
}

/** Start downloading + installing the CUDA runtime pack. */
export async function installGpuRuntime(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("gpu_runtime_install");
}

export async function cancelGpuRuntimeInstall(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("gpu_runtime_cancel");
}

export async function deleteGpuRuntime(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("gpu_runtime_delete");
}

/** Subscribe to CUDA runtime install progress. */
export function onGpuRuntimeProgress(
  handler: GpuRuntimeProgressHandler,
): () => void {
  if (!isTauri()) {
    return () => undefined;
  }
  const unlisten = listen("gpu://progress", (event) => {
    handler(gpuRuntimeProgressSchema.parse(event.payload));
  });
  return () => {
    void unlisten.then((stop) => {
      stop();
    });
  };
}
