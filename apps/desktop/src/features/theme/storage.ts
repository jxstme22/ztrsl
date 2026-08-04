import { appThemeSchema, DEFAULT_APP_THEME, type AppTheme } from "./theme";

const THEME_KEY = "local-squad-translator.theme.v1";

export function loadAppTheme(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): AppTheme {
  const serialized = storage.getItem(THEME_KEY);
  if (serialized === null) {
    return DEFAULT_APP_THEME;
  }
  const result = appThemeSchema.safeParse(serialized);
  return result.success ? result.data : DEFAULT_APP_THEME;
}

export function saveAppTheme(
  theme: AppTheme,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(THEME_KEY, theme);
}
