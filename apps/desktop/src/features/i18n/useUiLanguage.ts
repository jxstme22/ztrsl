import { useCallback, useEffect, useState } from "react";

import { setUiLanguage } from "./store";
import { loadUiLanguage, saveUiLanguage } from "./storage";
import { translate, type UIKey, type UiLanguage } from "./strings";

export function useUiLanguage() {
  const [language, setLanguage] = useState<UiLanguage>(loadUiLanguage);

  // Keep the prop-drilled controller and the global store in sync: components
  // that read `useT()` (Models, Sources, Diagnostics, Live) must re-render
  // when the Settings/Welcome pickers change the language.
  useEffect(() => {
    setUiLanguage(language);
    saveUiLanguage(language);
  }, [language]);

  const t = useCallback((key: UIKey) => translate(key, language), [language]);

  return { language, setLanguage, t };
}

export type UiLanguageController = ReturnType<typeof useUiLanguage>;
