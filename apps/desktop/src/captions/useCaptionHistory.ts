import { useCallback, useEffect, useRef, useState } from "react";

import type { Caption } from "../overlay/model";
import {
  clearHistoryState,
  emptyHistoryState,
  historyReducer,
  loadHistoryState,
  saveHistoryState,
  type HistoryContext,
  type HistoryState,
} from "./history";

/**
 * Owns the persisted final-caption history for the app window. The overlay
 * window keeps its own copy: it loads the same localStorage (shared origin)
 * and receives live updates over the `captions:history` event.
 */
export function useCaptionHistory() {
  const [state, setState] = useState<HistoryState>(loadHistoryState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveHistoryState(state);
  }, [state]);

  const record = useCallback(
    (caption: Caption, context?: HistoryContext) => {
      setState((current) =>
        historyReducer(current, {
          type: "record",
          caption,
          ...(context === undefined ? {} : { context }),
        }),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setState(emptyHistoryState());
    clearHistoryState();
  }, []);

  return { entries: state.entries, record, clear };
}
