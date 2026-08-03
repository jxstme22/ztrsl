import { useSyncExternalStore } from "react";

import { loadUiLanguage, saveUiLanguage } from "./storage";
import { translate, type UIKey, type UiLanguage } from "./strings";

/**
 * Lightweight global interface-language store.
 *
 * Unlike the earlier `useUiLanguage` hook (which keeps language in one
 * component and prop-drills `t`), this store lets ANY component read the
 * current language and translate strings directly, so Chinese is applied
 * across every page without threading props everywhere. The settings /
 * welcome pickers call `setUiLanguage`.
 */

let language: UiLanguage = loadUiLanguage();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getUiLanguage(): UiLanguage {
  return language;
}

export function setUiLanguage(next: UiLanguage): void {
  if (next === language) {
    return;
  }
  language = next;
  saveUiLanguage(next);
  notify();
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function subscribeUiLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: re-renders the component whenever the language changes. */
export function useUiLanguageValue(): UiLanguage {
  return useSyncExternalStore(subscribeUiLanguage, getUiLanguage, getUiLanguage);
}

/** Translate a key using the current global language. */
export function useT(): (key: UIKey) => string {
  const current = useUiLanguageValue();
  return (key: UIKey) => translate(key, current);
}
