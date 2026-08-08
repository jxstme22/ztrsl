import { useEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  currentSessionEntries,
  type HistoryEntry,
  loadHistoryState,
  visibleHistoryEntries,
  YOU_ACCENT_COLOR,
} from "./captions/history";
import { CaptionStack } from "./components/CaptionStack";
import { useT } from "./features/i18n/store";
import {
  beginOverlayDrag,
  emitDoneEditing,
  listenForHistory,
  listenForOverlaySnapshots,
  persistCurrentOverlayPlacement,
  restoreOverlayPlacement,
} from "./overlay/bridge";
import { DEFAULT_OVERLAY_SNAPSHOT } from "./overlay/model";

export function OverlayApp() {
  const [snapshot, setSnapshot] = useState(DEFAULT_OVERLAY_SNAPSHOT);
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    currentSessionEntries(loadHistoryState()),
  );
  const t = useT();

  // The overlay is always dark-styled: a transparent caption bar over the
  // game (or a dark history panel) must never pick up the app's light theme.
  // It is also a game-overlay surface: the document must never scroll and no
  // scrollbar may ever appear inside this window.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.dataset.theme = "dark";
    root.classList.add("overlay-root");
    body.classList.add("overlay-body");
    return () => {
      root.classList.remove("overlay-root");
      body.classList.remove("overlay-body");
    };
  }, []);

  // The overlay window owns its own visibility: it never shows at startup
  // and hides whenever the snapshot says so, even if the control window's
  // handle to this window misbehaves on some platforms. The control window
  // only drives mode/content via the snapshot.
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    void getCurrentWindow().hide();
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    const overlay = getCurrentWindow();
    if (snapshot.visible) {
      void overlay.show();
    } else {
      void overlay.hide();
    }
  }, [snapshot.visible]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;

    void listenForOverlaySnapshots((next) => {
      setSnapshot(next);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    });

    void listenForHistory((entries) => {
      setHistory(entries);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  const historyFontSize = Math.round(14 * snapshot.settings.fontScale);
  // While the user is dragging (or just finished), don't let snapshot syncs
  // re-apply the stored placement — that would fight the drag, especially
  // when captions are arriving mid-move.
  const draggingRef = useRef(false);
  // Snapshot events arrive constantly while live translation runs; every
  // event carries a freshly-created settings object. Only re-apply the
  // placement when the placement fields actually changed, so an unchanged
  // settings object can never yank the window back mid-move.
  const lastPlacementKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (draggingRef.current) {
      return;
    }
    const settings = snapshot.settings;
    const key = JSON.stringify([
      settings.monitorId,
      settings.xNormalized,
      settings.yNormalized,
      settings.widthNormalized,
      settings.heightNormalized,
    ]);
    if (key === lastPlacementKeyRef.current) {
      return;
    }
    lastPlacementKeyRef.current = key;
    void restoreOverlayPlacement(settings);
  }, [snapshot.settings]);

  // Chat order: entries are stored oldest-first, newest last. The list uses
  // flex-direction: column-reverse with the array reversed for rendering, so
  // the newest translation is always pinned to the visual bottom with no
  // scroll anchoring to keep in sync.
  const maxRows = snapshot.settings.historyMaxRows;
  const shownHistory = visibleHistoryEntries(history, maxRows);
  const reversedHistory = [...shownHistory].reverse();

  async function handleDrag() {
    draggingRef.current = true;
    await beginOverlayDrag();
    const settings = await persistCurrentOverlayPlacement(snapshot.settings);
    setSnapshot((current) => ({ ...current, settings }));
    window.setTimeout(() => {
      draggingRef.current = false;
    }, 600);
  }

  async function handleDoneEditing() {
    await persistCurrentOverlayPlacement(snapshot.settings);
    await emitDoneEditing();
  }

  /** Per-source accent for the speaker badge (tinted, colored text). */
  const badgeStyle = (
    color: string,
  ): { color?: string; backgroundColor?: string } =>
    /^#[0-9a-fA-F]{6}$/.test(color)
      ? { backgroundColor: `${color}26`, color }
      : {};

  return (
    <main
      className="overlay-shell"
      data-mode={snapshot.mode}
      data-history={snapshot.historyView || undefined}
      data-rows={snapshot.settings.historyMaxRows}
      aria-label={t("overlayAriaLabel")}
    >
      {snapshot.mode === "edit" && (
        <div className="edit-toolbar">
          <span>{t("overlayEditModeHint")}</span>
          <button
            type="button"
            aria-label={t("overlayDragLabel")}
            onPointerDown={() => {
              void handleDrag();
            }}
          >
            <GripHorizontal aria-hidden="true" size={22} />
          </button>
          <button
            type="button"
            className="edit-toolbar-done"
            onClick={() => {
              void handleDoneEditing();
            }}
          >
            {t("overlayDoneEditing")}
          </button>
        </div>
      )}
      {snapshot.historyView ? (
        <div
          className="overlay-history"
          style={
            {
              "--history-opacity": snapshot.settings.backgroundOpacity,
            } as React.CSSProperties
          }
        >
          {history.length === 0 ? (
            <p className="overlay-history-empty">{t("overlayHistoryEmpty")}</p>
          ) : (
            <ol className="overlay-history-list">
              {reversedHistory.map((entry) => (
                <li
                  key={entry.id}
                  className={`overlay-history-entry ${entry.fromSelf ? "self" : ""}`}
                  data-uncertain={entry.uncertain || undefined}
                >
                  {(entry.displayName !== "" || entry.sourceLabel !== "") && (
                    <span
                      className="overlay-history-source"
                      style={{
                        ...badgeStyle(
                          entry.fromSelf ? YOU_ACCENT_COLOR : entry.color,
                        ),
                        fontSize:
                          String(Math.round(historyFontSize * 0.78)) + "px",
                      }}
                    >
                      {entry.fromSelf
                        ? t("historyYou")
                        : entry.displayName !== ""
                          ? entry.displayName
                          : entry.sourceLabel}
                    </span>
                  )}
                  <span
                    className="overlay-history-text"
                    style={{ fontSize: String(historyFontSize) + "px" }}
                  >
                    {entry.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <CaptionStack snapshot={snapshot} mode="mini" />
      )}
    </main>
  );
}
