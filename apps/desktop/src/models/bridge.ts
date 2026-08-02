import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

import {
  EMPTY_MODELS_LIST,
  modelsListSchema,
  modelProgressSchema,
  type ModelsList,
  type ModelProgress,
} from "./model";

export type ProgressHandler = (event: ModelProgress) => void;

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
    void unlisten.then((stop) => { stop(); });
  };
}
