import { useCallback, useEffect, useRef, useState } from "react";

import type { CaptionPayload } from "../ipc/model";
import type { Caption } from "../overlay/model";
import { readingDurationMs } from "../overlay/reducer";
import {
  fetchLiveSnapshot,
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
  const running = useRef(false);
  const polling = useRef(false);
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;

  const applySnapshot = useCallback((next: LiveSnapshot) => {
    setSnapshot(next);
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
    ) => {
      setState("starting");
      setError(null);
      setLastCaption(null);
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
      applySnapshot(await stopLiveTranslation());
      running.current = false;
      setState("idle");
      setError(null);
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [applySnapshot]);

  return { error, lastCaption, snapshot, start, state, stop };
}
