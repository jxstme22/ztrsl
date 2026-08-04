import { useEffect, useState } from "react";
import { GripHorizontal } from "lucide-react";

import { type HistoryEntry, loadHistoryState } from "./captions/history";
import { CaptionStack } from "./components/CaptionStack";
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
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadHistoryState().entries,
  );

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

  return (
    <main
      className="overlay-shell"
      data-mode={snapshot.mode}
      data-history={snapshot.historyView || undefined}
      aria-label="Caption overlay"
    >
      {snapshot.mode === "edit" && (
        <div className="edit-toolbar">
          <span>Edit mode · drag to position</span>
          <button
            type="button"
            aria-label="Drag caption overlay"
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
            <p className="overlay-history-empty">No captions yet</p>
          ) : (
            <ol className="overlay-history-list">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="overlay-history-entry"
                  data-uncertain={entry.uncertain || undefined}
                >
                  {(entry.displayName !== "" ||
                    entry.sourceLabel !== "") && (
                    <span className="overlay-history-source">
                      {entry.displayName !== ""
                        ? entry.displayName
                        : entry.sourceLabel}
                    </span>
                  )}
                  <span className="overlay-history-text">{entry.text}</span>
                  {entry.audioSource !== "" && (
                    <span className="overlay-history-audio">
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
