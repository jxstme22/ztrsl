import { useEffect, useState } from "react";
import { GripHorizontal } from "lucide-react";

import { CaptionStack } from "./components/CaptionStack";
import {
  beginOverlayDrag,
  listenForOverlaySnapshots,
  persistCurrentOverlayPlacement,
  restoreOverlayPlacement,
} from "./overlay/bridge";
import { DEFAULT_OVERLAY_SNAPSHOT } from "./overlay/model";

export function OverlayApp() {
  const [snapshot, setSnapshot] = useState(DEFAULT_OVERLAY_SNAPSHOT);

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
      <CaptionStack snapshot={snapshot} mode="latest" />
    </main>
  );
}
