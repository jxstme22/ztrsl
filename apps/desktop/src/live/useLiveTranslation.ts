import { useCallback, useEffect, useRef, useState } from "react";

import type { CaptionPayload } from "../ipc/model";
import type { Caption } from "../overlay/model";
import type { LiveSourceRequest } from "./bridge";
import { readingDurationMs } from "../overlay/reducer";
import { loadSourceConfigs } from "../sources/storage";
import {
  fetchLiveSnapshot,
  setLiveMicEnabled,
  startLiveTranslation,
  stopLiveTranslation,
  type AsrProvider,
  type SourceMode,
  type TargetLanguage,
  type TranslationProvider,
} from "./bridge";
import { EMPTY_LIVE_SNAPSHOT, type LiveSnapshot } from "./model";

export type LiveUiState =
  "idle" | "starting" | "listening" | "stopping" | "error";

export function useLiveTranslation(onCaption: (caption: Caption) => void) {
  const [state, setState] = useState<LiveUiState>("idle");
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [lastCaption, setLastCaption] = useState<CaptionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionEndpointId, setSessionEndpointId] = useState<string | null>(
    null,
  );
  // History session the live pipeline appends into. A hint from the caller
  // (a kept-open session id) is reused as-is; otherwise a fresh id is born
  // when the user starts live translation.
  const [sessionId, setSessionId] = useState<string | null>(null);
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
      setError(next.error ?? "Live translation stopped unexpectedly.");
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
      setLastCaption(payload);
      // v0.4: suppressed captions are withheld from the overlay lanes — they
      // are never flashed briefly (final-caption terminality is preserved).
      if (payload.certainty?.state === "suppressed") {
        continue;
      }
      onCaptionRef.current({
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
        latencyMs: payload.capture_to_caption_ms,
        source:
          payload.source_id === undefined ||
          payload.source_snapshot === undefined
            ? undefined
            : {
                sourceId: payload.source_id,
                captionTag: payload.source_snapshot.caption_tag,
                labelStyle: payload.source_snapshot.label_style,
                color: payload.source_snapshot.color,
                // Per-source caption alignment override, stamped at capture so
                // the overlay never needs to read live source config.
                captionAlignment:
                  loadSourceConfigs().sources.find(
                    (config) => config.sourceId === payload.source_id,
                  )?.captionAlignment ?? "center",
              },
        certainty:
          payload.certainty === undefined
            ? undefined
            : {
                state: payload.certainty.state,
                uncertaintyReasons: payload.certainty.uncertainty_reasons,
                suppressionReason: payload.certainty.suppression_reason,
              },
      });
    }
  }, []);

  useEffect(() => {
    if (state !== "listening") {
      return;
    }
    const timer = window.setInterval(() => {
      if (polling.current) {
        return;
      }
      polling.current = true;
      void fetchLiveSnapshot()
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
    return () => {
      window.clearInterval(timer);
    };
  }, [applySnapshot, state]);

  useEffect(
    () => () => {
      if (running.current) {
        void stopLiveTranslation();
      }
    },
    [],
  );

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
      sessionIdHint: string | null = null,
      micSource: LiveSourceRequest | null = null,
    ) => {
      setState("starting");
      setError(null);
      setLastCaption(null);
      setSessionEndpointId(endpointId);
      // Reuse a kept-open session when the caller asks for one, otherwise
      // start a fresh history session for this live run.
      setSessionId(sessionIdHint ?? `sess-${String(Date.now())}`);
      try {
        applySnapshot(
          await startLiveTranslation(
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
            micSource,
          ),
        );
      } catch (cause) {
        running.current = false;
        setState("error");
        setError(cause instanceof Error ? cause.message : String(cause));
        setSessionId(null);
      }
    },
    [applySnapshot],
  );

  const setMicEnabled = useCallback(
    async (
      enabled: boolean,
      micSource: LiveSourceRequest | null = null,
    ): Promise<boolean> => {
      try {
        const next = await setLiveMicEnabled(enabled, micSource);
        setSnapshot((current) => ({ ...current, micEnabled: next }));
        return next;
      } catch (cause) {
        // Surface the failure to the caller (the History page shows it next
        // to the mic button) instead of swallowing it silently.
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    setState("stopping");
    try {
      applySnapshot(await stopLiveTranslation());
      running.current = false;
      setState("idle");
      setError(null);
      setSessionEndpointId(null);
      setSessionId(null);
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [applySnapshot]);

  return {
    error,
    lastCaption,
    sessionEndpointId,
    sessionId,
    setMicEnabled,
    snapshot,
    start,
    state,
    stop,
    warning,
  };
}
