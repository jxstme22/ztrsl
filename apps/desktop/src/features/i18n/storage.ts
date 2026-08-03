import { uiLanguageSchema, type UiLanguage } from "./strings";

const LANGUAGE_KEY = "local-squad-translator.ui-language.v1";

export function loadUiLanguage(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): UiLanguage {
  const serialized = storage.getItem(LANGUAGE_KEY);
  if (serialized === null) {
    return "en";
  }
  const result = uiLanguageSchema.safeParse(serialized);
  return result.success ? result.data : "en";
}

export function saveUiLanguage(
  language: UiLanguage,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(LANGUAGE_KEY, language);
}
