import { z } from "zod";

const AUDIO_SELECTION_KEY = "local-squad-translator.audio-selection.v1";
const storedSelectionSchema = z.object({
  endpointId: z.string().min(1).nullable(),
});

export function loadSelectedEndpointId(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): string | null {
  const serialized = storage.getItem(AUDIO_SELECTION_KEY);
  if (serialized === null) {
    return null;
  }
  try {
    const result = storedSelectionSchema.safeParse(JSON.parse(serialized));
    return result.success ? result.data.endpointId : null;
  } catch {
    return null;
  }
}

export function saveSelectedEndpointId(
  endpointId: string | null,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(AUDIO_SELECTION_KEY, JSON.stringify({ endpointId }));
}
