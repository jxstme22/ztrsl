import { useSyncExternalStore } from "react";

import { loadAppTheme, saveAppTheme } from "./storage";
import type { AppTheme } from "./theme";

/**
 * Lightweight global theme store (mirrors the i18n store pattern).
 *
 * The chosen theme is applied to `<html data-theme="...">` so the CSS
 * variable overrides in styles.css switch the whole interface, and it is
 * persisted so the next launch opens with the same theme.
 */

let theme: AppTheme = loadAppTheme();
const listeners = new Set<() => void>();

function applyTheme(next: AppTheme): void {
  document.documentElement.dataset.theme = next;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Apply the persisted theme to the document (call once at startup). */
export function initAppTheme(): void {
  applyTheme(theme);
}

export function getAppTheme(): AppTheme {
  return theme;
}

export function setAppTheme(next: AppTheme): void {
  if (next === theme) {
    return;
  }
  theme = next;
  saveAppTheme(next);
  applyTheme(next);
  notify();
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function subscribeAppTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: re-renders the component whenever the theme changes. */
export function useAppThemeValue(): AppTheme {
  return useSyncExternalStore(
    subscribeAppTheme,
    getAppTheme,
    getAppTheme,
  );
}
