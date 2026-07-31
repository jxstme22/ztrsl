import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchAudioEndpoints,
  fetchLevelSnapshot,
  startAudioMeter,
  stopAudioMeter,
} from "./bridge";
import {
  EMPTY_LEVEL,
  type AudioEndpoint,
  type EndpointCatalog,
  type LevelSnapshot,
} from "./model";
import { loadSelectedEndpointId, saveSelectedEndpointId } from "./storage";

export function useAudioMeter() {
  const [catalog, setCatalog] = useState<EndpointCatalog | null>(null);
  const [selectedEndpointId, setSelectedEndpointIdState] = useState<
    string | null
  >(loadSelectedEndpointId);
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState<LevelSnapshot>(EMPTY_LEVEL);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAudioEndpoints();
      setCatalog(next);
      setError(null);
      setSelectedEndpointIdState((selected) => {
        if (
          selected !== null &&
          !next.endpoints.some((endpoint) => endpoint.id === selected)
        ) {
          setActive(false);
        }
        return selected;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!active || selectedEndpointId === null) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchLevelSnapshot(selectedEndpointId)
        .then((snapshot) => {
          setLevel(snapshot);
          setError(null);
        })
        .catch((cause: unknown) => {
          setActive(false);
          setLevel(EMPTY_LEVEL);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, selectedEndpointId]);

  useEffect(
    () => () => {
      void stopAudioMeter();
    },
    [],
  );

  const captureEndpoints = useMemo(
    () =>
      (catalog?.endpoints ?? []).filter(
        (endpoint): endpoint is AudioEndpoint => endpoint.kind === "capture",
      ),
    [catalog],
  );
  const renderEndpoints = useMemo(
    () =>
      (catalog?.endpoints ?? []).filter(
        (endpoint): endpoint is AudioEndpoint => endpoint.kind === "render",
      ),
    [catalog],
  );

  const selectedEndpoint =
    captureEndpoints.find((endpoint) => endpoint.id === selectedEndpointId) ??
    null;

  const selectEndpoint = useCallback((endpointId: string | null) => {
    setSelectedEndpointIdState(endpointId);
    saveSelectedEndpointId(endpointId);
    setActive(false);
    setLevel(EMPTY_LEVEL);
    void stopAudioMeter();
  }, []);

  const start = useCallback(async () => {
    if (selectedEndpointId === null) {
      setError("Choose a capture endpoint first.");
      return;
    }
    try {
      await startAudioMeter(selectedEndpointId);
      setActive(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [selectedEndpointId]);

  const stop = useCallback(async () => {
    await stopAudioMeter();
    setActive(false);
    setLevel(EMPTY_LEVEL);
  }, []);

  return {
    active,
    captureEndpoints,
    catalog,
    error,
    level,
    renderEndpoints,
    refresh,
    selectEndpoint,
    selectedEndpoint,
    selectedEndpointId,
    start,
    stop,
  };
}
