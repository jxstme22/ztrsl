import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchAudioEndpoints } from "../audio/bridge";
import type { AudioEndpoint } from "../audio/model";
import {
  fetchRoutingSnapshot,
  setRoutingVolume,
  startRouting,
  stopRouting,
} from "./bridge";
import { EMPTY_ROUTING_SNAPSHOT } from "./model";

export function useRoutingTest() {
  const [endpoints, setEndpoints] = useState<AudioEndpoint[]>([]);
  const [platform, setPlatform] = useState<"windows" | "development">(
    "development",
  );
  const [captureId, setCaptureId] = useState("");
  const [playbackId, setPlaybackId] = useState("");
  const [volume, setVolumeState] = useState(0.8);
  const [active, setActive] = useState(false);
  const [snapshot, setSnapshot] = useState(EMPTY_ROUTING_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAudioEndpoints()
      .then((catalog) => {
        setEndpoints(catalog.endpoints);
        setPlatform(catalog.platform);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchRoutingSnapshot()
        .then(setSnapshot)
        .catch((cause: unknown) => {
          setActive(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);

  useEffect(
    () => () => {
      void stopRouting();
    },
    [],
  );

  const captures = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === "capture"),
    [endpoints],
  );
  const playbacks = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === "render"),
    [endpoints],
  );

  const start = useCallback(async () => {
    try {
      await startRouting(captureId, playbackId, volume);
      setActive(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [captureId, playbackId, volume]);

  const stop = useCallback(async () => {
    await stopRouting();
    setActive(false);
    setSnapshot(EMPTY_ROUTING_SNAPSHOT);
  }, []);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    void setRoutingVolume(next);
  }, []);

  return {
    active,
    captureId,
    captures,
    error,
    playbackId,
    playbacks,
    platform,
    setCaptureId,
    setPlaybackId,
    setVolume,
    snapshot,
    start,
    stop,
    volume,
  };
}
