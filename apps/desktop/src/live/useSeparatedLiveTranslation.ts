import { useCallback, useEffect, useRef, useState } from "react";

import type { CaptionPayload } from "../ipc/model";
import type { Caption } from "../overlay/model";
import {
  fetchSeparatedLiveSnapshot,
  startSeparatedLiveTranslation,
  stopSeparatedLiveTranslation,
  type AsrProvider,
  type LiveSourceRequest,
  type SourceMode,
  type TargetLanguage,
  type TranslationProvider,
} from "./bridge";
import { EMPTY_LIVE_SNAPSHOT, type LiveSnapshot } from "./model";

export type SeparatedLiveUiState =
  "idle" | "starting" | "listening" | "stopping" | "error";

/**
 * The separated live session: a second, independent live translation run
 * from the history page. It shares the sidecar process (loaded models) with
 * the main live session and records into the same history session, but has
 * its own capture endpoint and configuration. Its captions go to history
 * only — never to the game overlay.
 */
export function useSeparatedLiveTranslation(
  onCaption: (caption: Caption) => void,
) {
  const [state, setState] = useState<SeparatedLiveUiState>("idle");
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionEndpointId, setSessionEndpointId] = useState<string | null>(
    null,
  );
  const running = useRef(false);
  const polling = useRef(false);
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;

  const applySnapshot = useCallback((next: LiveSnapshot) => {
    setSnapshot(next);
    setWarning(next.warning);
    if (next.error !== null || next.state === "error") {
      running.current = false;
      setState("error");
      setError(next.error ?? "Separated live stopped unexpectedly.");
    } else if (next.state === "listening") {
      running.current = true;
      setState("listening");
      setError(null);
    } else if (running.current) {
      running.current = false;
      setState("idle");
    }

    const createdAtMs = Date.now();
    for (const payload of next.captions) {
      onCaptionRef.current(captionFromPayload(payload, createdAtMs));
    }
  }, []);

  // Poll the snapshot while listening (same cadence as the main live hook).
  useEffect(() => {
    if (state !== "listening") {
      return;
    }
    const interval = window.setInterval(() => {
      if (polling.current) {
        return;
      }
      polling.current = true;
      void fetchSeparatedLiveSnapshot()
        .then(applySnapshot)
        .catch((cause: unknown) => {
          running.current = false;
          setState("error");
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          polling.current = false;
        });
    }, 250);
    return () => { window.clearInterval(interval); };
  }, [applySnapshot, state]);

  useEffect(() => {
    return () => {
      if (running.current) {
        void stopSeparatedLiveTranslation();
      }
    };
  }, []);

  const start = useCallback(
    async (
      endpointId: string,
      playbackEndpointId: string | null,
      provider: "demo" | "local" | "http",
      monitorEnabled: boolean,
      sourceMode: SourceMode,
      targetLanguage: TargetLanguage,
      asrProvider: AsrProvider,
      translationProvider: TranslationProvider,
      vadSensitivity = 50,
      segmentation: "chunk" | "balanced" | "sentence" = "balanced",
      sources: LiveSourceRequest[] = [],
    ) => {
      setState("starting");
      setError(null);
      setSessionEndpointId(endpointId);
      try {
        applySnapshot(
          await startSeparatedLiveTranslation(
            endpointId,
            playbackEndpointId,
            provider,
            monitorEnabled,
            sourceMode,
            targetLanguage,
            asrProvider,
            translationProvider,
            vadSensitivity,
            segmentation,
            sources,
          ),
        );
      } catch (cause) {
        running.current = false;
        setState("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [applySnapshot],
  );

  const stop = useCallback(async () => {
    setState("stopping");
    try {
      applySnapshot(await stopSeparatedLiveTranslation());
      running.current = false;
      setState("idle");
      setError(null);
      setSessionEndpointId(null);
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [applySnapshot]);

  return {
    error,
    sessionEndpointId,
    snapshot,
    start,
    state,
    stop,
    warning,
  };
}

function captionFromPayload(
  payload: CaptionPayload,
  createdAtMs: number,
): Caption {
  const readingMs = Math.max(
    1200,
    Math.min(7000, Math.round((payload.english_text.length / 14) * 1000)),
  );
  return {
    id: payload.caption_id,
    revision: payload.revision,
    status: payload.status,
    sourceText: payload.source_text,
    englishText: payload.english_text,
    createdAtMs,
    expiresAtMs:
      createdAtMs + (payload.status === "provisional" ? 4000 : readingMs),
    latencyMs: payload.capture_to_caption_ms,
    source:
      payload.source_id === undefined || payload.source_snapshot === undefined
        ? undefined
        : {
            sourceId: payload.source_id,
            captionTag: payload.source_snapshot.caption_tag,
            labelStyle: payload.source_snapshot.label_style,
            color: payload.source_snapshot.color,
            captionAlignment: "center",
          },
    certainty: payload.certainty
      ? {
          state: payload.certainty.state,
          uncertaintyReasons: payload.certainty.uncertainty_reasons,
          suppressionReason: payload.certainty.suppression_reason,
        }
      : {
          state: "normal",
          uncertaintyReasons: [],
          suppressionReason: null,
        },
  };
}
