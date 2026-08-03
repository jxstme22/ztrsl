import { useCallback, useEffect, useState } from "react";

import { loadUiLanguage, saveUiLanguage } from "./storage";
import { translate, type UIKey, type UiLanguage } from "./strings";

export function useUiLanguage() {
  const [language, setLanguage] = useState<UiLanguage>(loadUiLanguage);

  useEffect(() => {
    saveUiLanguage(language);
  }, [language]);

  const t = useCallback((key: UIKey) => translate(key, language), [language]);

  return { language, setLanguage, t };
}

export type UiLanguageController = ReturnType<typeof useUiLanguage>;
