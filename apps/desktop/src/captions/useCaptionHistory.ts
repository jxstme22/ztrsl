import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 *
 * History is grouped into sessions: live translation appends into the
 * current session, which starts when live starts and ends (or stays open)
 * via the stop-live confirmation modal.
 */
export function useCaptionHistory() {
  const [state, setState] = useState<HistoryState>(loadHistoryState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveHistoryState(state);
  }, [state]);

  const record = useCallback((caption: Caption, context?: HistoryContext) => {
    setState((current) =>
      historyReducer(current, {
        type: "record",
        caption,
        ...(context === undefined ? {} : { context }),
      }),
    );
  }, []);

  const beginSession = useCallback((id: string, name: string) => {
    setState((current) =>
      historyReducer(current, { type: "beginSession", id, name }),
    );
  }, []);

  const endSession = useCallback((id: string) => {
    setState((current) =>
      historyReducer(current, { type: "endSession", id }),
    );
  }, []);

  const renameSession = useCallback((id: string, name: string) => {
    setState((current) =>
      historyReducer(current, { type: "renameSession", id, name }),
    );
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((current) =>
      historyReducer(current, { type: "deleteSession", id }),
    );
  }, []);

  const selectSession = useCallback((id: string | null) => {
    setState((current) =>
      historyReducer(current, { type: "selectSession", id }),
    );
  }, []);

  const clearSession = useCallback((id: string) => {
    setState((current) =>
      historyReducer(current, { type: "clearSession", id }),
    );
  }, []);

  const clear = useCallback(() => {
    setState(emptyHistoryState());
    clearHistoryState();
  }, []);

  const activeSession = useMemo(
    () =>
      state.sessions.find(
        (session) => session.id === state.currentSessionId,
      ) ?? null,
    [state],
  );

  return {
    sessions: state.sessions,
    currentSessionId: state.currentSessionId,
    activeSession,
    activeEntries: activeSession?.entries ?? [],
    record,
    beginSession,
    endSession,
    renameSession,
    deleteSession,
    selectSession,
    clearSession,
    clear,
  };
}
