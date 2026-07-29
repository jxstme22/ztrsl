import { useCallback, useEffect, useState } from "react";

import type { Caption } from "../overlay/model";
import { readingDurationMs } from "../overlay/reducer";
import { runFakeInference, startSidecar, stopSidecar } from "./bridge";

export type SidecarUiState = "stopped" | "starting" | "ready" | "crashed";

export function useSidecar(onCaption: (caption: Caption) => void) {
  const [state, setState] = useState<SidecarUiState>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  useEffect(
    () => () => {
      void stopSidecar();
    },
    [],
  );

  const start = useCallback(async () => {
    setState("starting");
    try {
      await startSidecar();
      setState("ready");
      setError(null);
    } catch (cause) {
      setState("crashed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const run = useCallback(async () => {
    try {
      const captions = await runFakeInference();
      const createdAtMs = Date.now();
      for (const envelope of captions) {
        const payload = envelope.payload;
        onCaption({
          id: payload.caption_id,
          revision: payload.revision,
          status: payload.status,
          sourceText: payload.source_text,
          englishText: payload.english_text,
          createdAtMs,
          expiresAtMs:
            createdAtMs +
            (payload.status === "final"
              ? readingDurationMs(payload.english_text)
              : 4_000),
        });
      }
      const finalCaption = captions.at(-1);
      setLastLatencyMs(finalCaption?.payload.capture_to_caption_ms ?? null);
      setError(null);
    } catch (cause) {
      setState("crashed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onCaption]);

  const stop = useCallback(async () => {
    await stopSidecar();
    setState("stopped");
  }, []);

  return { error, lastLatencyMs, run, start, state, stop };
}
