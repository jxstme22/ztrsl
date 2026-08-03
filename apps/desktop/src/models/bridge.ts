import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

import {
  EMPTY_MODELS_LIST,
  EMPTY_PROVIDER_STATUS,
  downloadEndpointSchema,
  modelsListSchema,
  modelProgressSchema,
  providerStatusSchema,
  type DownloadEndpointInfo,
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
  return z.array(z.string()).parse(await invoke("models_import_offline_pack", { packDir }));
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
