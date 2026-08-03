import { useCallback, useEffect, useState } from "react";

import { runFakeMultiSourceInference } from "../ipc/bridge";
import { type DiagnosticsSnapshot, EMPTY_DIAGNOSTICS } from "./model";
import { classifyLeakage } from "./leakage";

/**
 * Holds the current diagnostics snapshot for the Diagnostics panel.
 *
 * In the browser/dev runtime the snapshot starts empty and the panel renders
 * its empty state; the leakage check runs the multi-source fake roundtrip and
 * classifies it with `classifyLeakage` (which inspects only source identity,
 * never transcript content — Phase 10).
 */
export function useDiagnostics() {
  const [snapshot, setSnapshot] =
    useState<DiagnosticsSnapshot>(EMPTY_DIAGNOSTICS);
  const [updatedAtMs, setUpdatedAtMs] = useState(0);
  const [leakageRunning, setLeakageRunning] = useState(false);

  const applyDiagnostics = useCallback((next: DiagnosticsSnapshot) => {
    setSnapshot(next);
    setUpdatedAtMs(Date.now());
  }, []);

  const runLeakage = useCallback(async () => {
    setLeakageRunning(true);
    try {
      const captions = await runFakeMultiSourceInference();
      const leakage = classifyLeakage(captions);
      setSnapshot((current) => ({ ...current, leakage }));
      setUpdatedAtMs(Date.now());
    } catch {
      setSnapshot((current) => ({
        ...current,
        leakage: {
          passed: false,
          checkedAtMs: Date.now(),
          detail:
            "The isolation check requires the desktop runtime (multi-source fake inference).",
        },
      }));
      setUpdatedAtMs(Date.now());
    } finally {
      setLeakageRunning(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setUpdatedAtMs(Date.now());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    applyDiagnostics,
    leakageRunning,
    refresh,
    runLeakage,
    snapshot,
    updatedAtMs,
  };
}
