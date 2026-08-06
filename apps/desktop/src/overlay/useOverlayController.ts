import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  listenForDoneEditing,
  listenForHideOverlay,
  listenForToggleHistoryView,
  listenForOverlaySettings,
  listenForRecoveredOverlay,
  registerHotkeys,
  syncOverlayWindow,
  unregisterHotkeys,
  type HotkeyErrors,
} from "./bridge";
import { setWindowedOverlay, isMacos } from "../windowEffects";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULT_OVERLAY_SNAPSHOT,
  type Caption,
  type HotkeyAction,
  type HotkeySettings,
  type OverlayMode,
  type OverlaySettings,
  type OverlaySnapshot,
} from "./model";
import { normalizeSettings } from "./placement";
import { captionReducer, readingDurationMs } from "./reducer";
import { loadOverlaySettings, saveOverlaySettings } from "./storage";

const FAKE_SOURCE = "Adto ta sa B, naa na sila sa A.";
const FAKE_PROVISIONAL = "Let's rotate to B…";
const FAKE_FINAL = "Let's rotate to B—they're already on A.";

export function useOverlayController() {
  const [captions, dispatch] = useReducer(captionReducer, []);
  const [visible, setVisible] = useState(DEFAULT_OVERLAY_SNAPSHOT.visible);
  const [mode, setMode] = useState<OverlayMode>(DEFAULT_OVERLAY_SNAPSHOT.mode);
  const [windowedMode, setWindowedMode] = useState(false);
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [settings, setSettings] = useState(loadOverlaySettings);
  const [hotkeyErrors, setHotkeyErrors] = useState<HotkeyErrors>({});
  const [windowError, setWindowError] = useState<string | null>(null);
  const [recoveredPlacement, setRecoveredPlacement] = useState(false);
  const fakeSequence = useRef(0);
  const timers = useRef<number[]>([]);
  const dismissed = useRef(false);

  const snapshot = useMemo<OverlaySnapshot>(
    () => ({
      visible,
      mode,
      translationEnabled,
      captions: [...captions],
      settings,
      historyView: settings.overlayContent === "history",
    }),
    [captions, mode, settings, translationEnabled, visible],
  );

  /** Toggle the overlay between the caption bar and the history panel. */
  const toggleHistoryView = useCallback(() => {
    setSettings((current) => ({
      ...current,
      overlayContent:
        current.overlayContent === "history" ? "captions" : "history",
    }));
    setVisible(true);
  }, []);

  useEffect(() => {
    saveOverlaySettings(settings);
  }, [settings]);

  useEffect(() => {
    void syncOverlayWindow(snapshot)
      .then(() => {
        setWindowError(null);
      })
      .catch(() => {
        setWindowError(
          "The overlay window did not respond. Keep the app open and try again.",
        );
      });
  }, [snapshot]);

  useEffect(() => {
    if (captions.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      dispatch({ type: "expire", nowMs: Date.now() });
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [captions.length]);

  useEffect(() => {
    let disposed = false;
    let stopRecovered: (() => void) | undefined;
    let stopSettings: (() => void) | undefined;
    let stopDoneEditing: (() => void) | undefined;
    let stopToggleView: (() => void) | undefined;
    let stopHide: (() => void) | undefined;

    void listenForRecoveredOverlay(() => {
      setRecoveredPlacement(true);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopRecovered = unlisten;
      }
    });

    void listenForOverlaySettings((next) => {
      setSettings(normalizeSettings(next));
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopSettings = unlisten;
      }
    });

    void listenForDoneEditing(() => {
      // The overlay's "Done" button: leave edit mode (placement was already
      // persisted on drag end), so click-through returns even mid-session.
      setMode("play");
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopDoneEditing = unlisten;
      }
    });

    void listenForToggleHistoryView(() => {
      // The overlay control strip's view toggle: swap the mini caption lane
      // and the full history panel.
      setSettings((current) => ({
        ...current,
        overlayContent:
          current.overlayContent === "history" ? "captions" : "history",
      }));
      setVisible(true);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopToggleView = unlisten;
      }
    });

    void listenForHideOverlay(() => {
      // The overlay control strip's close button: hide now and stay hidden
      // (new captions must not re-show it) until the user shows it again.
      dismissed.current = true;
      setVisible(false);
      setMode("play");
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopHide = unlisten;
      }
    });

    return () => {
      disposed = true;
      stopRecovered?.();
      stopSettings?.();
      stopDoneEditing?.();
      stopToggleView?.();
      stopHide?.();
    };
  }, []);

  const toggleWindowedMode = useCallback(() => {
    setWindowedMode((current) => !current);
    setVisible(false);
    setMode("play");
  }, []);

  useEffect(() => {
    void setWindowedOverlay(windowedMode).catch((error: unknown) => {
      setWindowError(
        typeof error === "string"
          ? error
          : "Windowed overlay mode failed to switch.",
      );
    });
  }, [windowedMode]);

  // The pin toggle only matters in windowed (mini) mode: the window floats
  // above other apps when pinned, and behaves normally when unpinned.
  const pin = useCallback(() => {
    setSettings((current) => {
      const next = { ...current, pinned: !current.pinned };
      void getCurrentWindow().setAlwaysOnTop(next.pinned).catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!windowedMode) {
      return;
    }
    void getCurrentWindow()
      .setAlwaysOnTop(settings.pinned)
      .catch(() => undefined);
  }, [windowedMode, settings.pinned]);

  const handleHotkey = useCallback(
    (action: HotkeyAction) => {
      switch (action) {
        case "toggleOverlay":
          if (isMacos()) {
            toggleWindowedMode();
          } else {
            setVisible((current) => !current);
          }
          break;
        case "toggleTranslation":
          setTranslationEnabled((current) => !current);
          break;
        case "toggleEditMode":
          setVisible(true);
          setMode((current) => (current === "edit" ? "play" : "edit"));
          break;
        case "clearCaptions":
          dispatch({ type: "clear" });
          break;
        case "increaseText":
          setSettings((current) =>
            normalizeSettings({
              ...current,
              fontScale: current.fontScale + 0.1,
            }),
          );
          break;
        case "decreaseText":
          setSettings((current) =>
            normalizeSettings({
              ...current,
              fontScale: current.fontScale - 0.1,
            }),
          );
          break;
        case "toggleHistory":
          setSettings((current) => ({
            ...current,
            overlayContent:
              current.overlayContent === "history" ? "captions" : "history",
          }));
          setVisible(true);
          break;
      }
    },
    [toggleWindowedMode],
  );

  useEffect(() => {
    let disposed = false;

    void registerHotkeys(settings.hotkeys, handleHotkey).then((errors) => {
      if (!disposed) {
        setHotkeyErrors(errors);
      }
    });

    return () => {
      disposed = true;
    };
  }, [handleHotkey, settings.hotkeys]);

  useEffect(
    () => () => {
      void unregisterHotkeys();
    },
    [],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  const showOverlay = useCallback(() => {
    setVisible(true);
  }, []);

  const hideOverlay = useCallback(() => {
    setVisible(false);
    setMode("play");
  }, []);

  const toggleEditMode = useCallback(() => {
    setVisible(true);
    setMode((current) => (current === "edit" ? "play" : "edit"));
  }, []);

  const clearCaptions = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  const ingestCaption = useCallback((caption: Caption) => {
    setVisible(true);
    dispatch({ type: "upsert", caption });
  }, []);

  const sendFakeCaption = useCallback(() => {
    if (!translationEnabled) {
      return;
    }

    fakeSequence.current += 1;
    const id = `fake-caption-${String(fakeSequence.current)}`;
    const createdAtMs = Date.now();
    const provisional: Caption = {
      id,
      revision: 1,
      status: "provisional",
      sourceText: FAKE_SOURCE,
      englishText: FAKE_PROVISIONAL,
      createdAtMs,
      expiresAtMs: createdAtMs + 4_000,
    };

    setVisible(true);
    dispatch({ type: "upsert", caption: provisional });

    timers.current.push(
      window.setTimeout(() => {
        dispatch({
          type: "upsert",
          caption: {
            ...provisional,
            revision: 2,
            englishText: "Let's rotate to B—they're on A…",
            expiresAtMs: Date.now() + 4_000,
          },
        });
      }, 650),
      window.setTimeout(() => {
        const finalizedAtMs = Date.now();
        dispatch({
          type: "upsert",
          caption: {
            ...provisional,
            revision: 3,
            status: "final",
            englishText: FAKE_FINAL,
            expiresAtMs: finalizedAtMs + readingDurationMs(FAKE_FINAL),
          },
        });
      }, 1_300),
    );
  }, [translationEnabled]);

  const updateSettings = useCallback((next: Partial<OverlaySettings>) => {
    setSettings((current) => normalizeSettings({ ...current, ...next }));
  }, []);

  const updateHotkeys = useCallback((hotkeys: HotkeySettings) => {
    setSettings((current) => ({ ...current, hotkeys }));
  }, []);

  const resetPlacement = useCallback(() => {
    setSettings((current) => ({
      ...current,
      monitorId: null,
      xNormalized: 0.5,
      yNormalized: 0.72,
      widthNormalized: 0.8,
    }));
    setRecoveredPlacement(false);
  }, []);

  const retryWindowSync = useCallback(() => {
    void syncOverlayWindow(snapshot)
      .then(() => {
        setWindowError(null);
      })
      .catch(() => {
        setWindowError("The overlay is still unavailable.");
      });
  }, [snapshot]);

  return {
    snapshot,
    hotkeyErrors,
    windowError,
    recoveredPlacement,
    windowedMode,
    showOverlay,
    hideOverlay,
    toggleWindowedMode,
    pin,
    toggleEditMode,
    toggleHistoryView,
    clearCaptions,
    ingestCaption,
    sendFakeCaption,
    setTranslationEnabled,
    updateSettings,
    updateHotkeys,
    resetPlacement,
    retryWindowSync,
  };
}
