import { z } from "zod";

const MODELS_SETTINGS_KEY = "local-squad-translator.models.v1";

const modelsSettingsSchema = z.object({
  /** User-chosen Hugging Face download endpoint; `null` means auto/env. */
  hfEndpoint: z.string().nullable(),
});

export type ModelsSettings = z.infer<typeof modelsSettingsSchema>;

export function loadModelsSettings(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): ModelsSettings {
  const serialized = storage.getItem(MODELS_SETTINGS_KEY);
  if (serialized === null) {
    return { hfEndpoint: null };
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = modelsSettingsSchema.safeParse(parsed);
    return result.success ? result.data : { hfEndpoint: null };
  } catch {
    return { hfEndpoint: null };
  }
}

export function saveModelsSettings(
  settings: ModelsSettings,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(MODELS_SETTINGS_KEY, JSON.stringify(settings));
}
