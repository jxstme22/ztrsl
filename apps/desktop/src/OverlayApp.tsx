import { useEffect, useState } from "react";
import { GripHorizontal } from "lucide-react";

import { type HistoryEntry, loadHistoryState } from "./captions/history";
import { CaptionStack } from "./components/CaptionStack";
import { useT } from "./features/i18n/store";
import {
  beginOverlayDrag,
  listenForHistory,
  listenForOverlaySnapshots,
  persistCurrentOverlayPlacement,
  restoreOverlayPlacement,
} from "./overlay/bridge";
import { DEFAULT_OVERLAY_SNAPSHOT } from "./overlay/model";

export function OverlayApp() {
  const [snapshot, setSnapshot] = useState(DEFAULT_OVERLAY_SNAPSHOT);
  const [history, setHistory] = useState<HistoryEntry[]>(
    () => loadHistoryState().entries,
  );
  const t = useT();

  // The overlay is always dark-styled: a transparent caption bar over the
  // game (or a dark history panel) must never pick up the app's light theme.
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

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

  useEffect(() => {
    void restoreOverlayPlacement(snapshot.settings);
  }, [snapshot.settings]);

  async function handleDrag() {
    await beginOverlayDrag();
    const settings = await persistCurrentOverlayPlacement(snapshot.settings);
    setSnapshot((current) => ({ ...current, settings }));
  }

  const historyFontSize = Math.round(14 * snapshot.settings.fontScale);

  return (
    <main
      className="overlay-shell"
      data-mode={snapshot.mode}
      data-history={snapshot.historyView || undefined}
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
        </div>
      )}
      {snapshot.historyView ? (
        <div className="overlay-history">
          {history.length === 0 ? (
            <p className="overlay-history-empty">{t("overlayHistoryEmpty")}</p>
          ) : (
            <ol className="overlay-history-list">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="overlay-history-entry"
                  data-uncertain={entry.uncertain || undefined}
                >
                  {(entry.displayName !== "" || entry.sourceLabel !== "") && (
                    <span
                      className="overlay-history-source"
                      style={{
                        fontSize:
                          String(Math.round(historyFontSize * 0.78)) + "px",
                      }}
                    >
                      {entry.displayName !== ""
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
                  {entry.audioSource !== "" && (
                    <span
                      className="overlay-history-audio"
                      style={{
                        fontSize:
                          String(Math.round(historyFontSize * 0.7)) + "px",
                      }}
                    >
                      {entry.audioSource}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <CaptionStack snapshot={snapshot} mode="latest" />
      )}
    </main>
  );
}
