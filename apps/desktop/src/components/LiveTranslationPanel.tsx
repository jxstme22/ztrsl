import { LoaderCircle, Play, Square } from "lucide-react";
import { useMemo, useState } from "react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import type { Caption } from "../overlay/model";
import { useLiveTranslation } from "../live/useLiveTranslation";
import { setTranslationEnv } from "../live/bridge";
import type { AsrProvider, TranslationProvider } from "../live/bridge";

type AudioController = ReturnType<typeof useAudioMeter>;

type LiveTranslationPanelProps = {
  audio: AudioController;
  onCaption: (caption: Caption) => void;
};

const INPUT_ENDPOINT_KEY = "lst.live.input-endpoint";
const PLAYBACK_ENDPOINT_KEY = "lst.live.playback-endpoint";
const MONITOR_ENABLED_KEY = "lst.live.monitor";
const SOURCE_MODE_KEY = "lst.live.source-mode";
const ASR_PROVIDER_KEY = "lst.live.asr-provider";
const VAD_SENSITIVITY_KEY = "lst.live.vad-sensitivity";
const GROQ_API_KEY_KEY = "lst.live.groq-api-key";
const TRANSLATION_PROVIDER_KEY = "lst.live.translation-provider";
const LT_ENDPOINT_KEY = "lst.live.lt-endpoint";
const LT_API_KEY_KEY = "lst.live.lt-api-key";
const CUSTOM_TX_ENDPOINT_KEY = "lst.live.custom-tx-endpoint";
const CUSTOM_TX_API_KEY_KEY = "lst.live.custom-tx-api-key";

function loadStored(key: string): string | null {
  return window.localStorage.getItem(key);
}

function loadMonitorEnabled(): boolean {
  return window.localStorage.getItem(MONITOR_ENABLED_KEY) === "true";
}

function loadSourceMode(): "filipino" | "chinese" {
  return window.localStorage.getItem(SOURCE_MODE_KEY) === "chinese"
    ? "chinese"
    : "filipino";
}

function loadAsrProvider(): AsrProvider {
  const stored = window.localStorage.getItem(ASR_PROVIDER_KEY);
  if (
    stored === "whisper-turbo" ||
    stored === "whisper-full" ||
    stored === "ncspeech" ||
    stored === "groq-whisper"
  ) {
    return stored;
  }
  return "local";
}

function loadVadSensitivity(): number {
  const stored = window.localStorage.getItem(VAD_SENSITIVITY_KEY);
  if (stored === null) {
    return 50;
  }
  const parsed = Number.parseInt(stored, 10);
  if (Number.isNaN(parsed)) {
    return 50;
  }
  return Math.max(0, Math.min(100, parsed));
}

function loadTranslationProvider(): TranslationProvider {
  const stored = window.localStorage.getItem(TRANSLATION_PROVIDER_KEY);
  if (
    stored === "madlad" ||
    stored === "libretranslate" ||
    stored === "google-translate" ||
    stored === "mymemory" ||
    stored === "custom-http"
  ) {
    return stored;
  }
  return "madlad";
}

function setEnvVar(name: string, value: string) {
  // Persist configuration in localStorage so the user can switch providers
  // without editing environment variables. The Tauri sidecar picks these up
  // only when launched by the supervisor — for now this UI sends them as
  // part of start_live_translation, and the Rust bridge forwards them to
  // the sidecar via env vars on the supervisor's spawn call.
  if (value) {
    window.localStorage.setItem(name, value);
  } else {
    window.localStorage.removeItem(name);
  }
}

async function pushProviderEnv(
  asrProvider: AsrProvider,
  translationProvider: TranslationProvider,
  config: {
    groqApiKey: string;
    ltEndpoint: string;
    ltApiKey: string;
    customTxEndpoint: string;
    customTxApiKey: string;
  },
): Promise<void> {
  const pairs: [string, string][] = [];
  if (asrProvider === "groq-whisper") {
    pairs.push(["LST_GROQ_API_KEY", config.groqApiKey]);
  }
  if (translationProvider === "libretranslate") {
    pairs.push(["LST_LT_ENDPOINT", config.ltEndpoint]);
    pairs.push(["LST_LT_API_KEY", config.ltApiKey]);
  } else if (translationProvider === "custom-http") {
    pairs.push(["LST_CUSTOM_TX_ENDPOINT", config.customTxEndpoint]);
    pairs.push(["LST_CUSTOM_TX_API_KEY", config.customTxApiKey]);
  }
  await setTranslationEnv(pairs);
}

export function LiveTranslationPanel({
  audio,
  onCaption,
}: LiveTranslationPanelProps) {
  const live = useLiveTranslation(onCaption);
  const [inputEndpointId, setInputEndpointId] = useState<string | null>(
    () => loadStored(INPUT_ENDPOINT_KEY),
  );
  const [playbackEndpointId, setPlaybackEndpointId] = useState<string | null>(
    () => loadStored(PLAYBACK_ENDPOINT_KEY),
  );
  const [monitorEnabled, setMonitorEnabled] = useState<boolean>(
    loadMonitorEnabled,
  );
  const [sourceMode, setSourceMode] = useState<"filipino" | "chinese">(
    loadSourceMode,
  );
  const [asrProvider, setAsrProvider] = useState<AsrProvider>(loadAsrProvider);
  const [vadSensitivity, setVadSensitivity] = useState<number>(
    loadVadSensitivity,
  );
  const [groqApiKey, setGroqApiKey] = useState<string>(
    () => window.localStorage.getItem(GROQ_API_KEY_KEY) ?? "",
  );
  const [translationProvider, setTranslationProvider] =
    useState<TranslationProvider>(loadTranslationProvider);
  const [ltEndpoint, setLtEndpoint] = useState<string>(
    () => window.localStorage.getItem(LT_ENDPOINT_KEY) ?? "",
  );
  const [ltApiKey, setLtApiKey] = useState<string>(
    () => window.localStorage.getItem(LT_API_KEY_KEY) ?? "",
  );
  const [customTxEndpoint, setCustomTxEndpoint] = useState<string>(
    () => window.localStorage.getItem(CUSTOM_TX_ENDPOINT_KEY) ?? "",
  );
  const [customTxApiKey, setCustomTxApiKey] = useState<string>(
    () => window.localStorage.getItem(CUSTOM_TX_API_KEY_KEY) ?? "",
  );
  const isSimulator = audio.catalog?.platform === "development";
  const busy = live.state === "starting" || live.state === "stopping";
  const listening = live.state === "listening";

  const endpoints = audio.catalog?.endpoints ?? [];
  const captureInputs = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === "capture"),
    [endpoints],
  );
  const loopbackInputs = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === "render"),
    [endpoints],
  );

  const selectedInput =
    endpoints.find((endpoint) => endpoint.id === inputEndpointId) ?? null;
  const inputReady =
    selectedInput !== null && selectedInput.state === "active";

  const playbackEndpoint =
    endpoints.find(
      (endpoint) => endpoint.id === playbackEndpointId && endpoint.kind === "render",
    ) ?? null;
  const playbackReady =
    playbackEndpoint !== null && playbackEndpoint.state === "active";

  const configComplete =
    (asrProvider !== "groq-whisper" || groqApiKey.trim().length > 0) &&
    (translationProvider !== "libretranslate" ||
      ltEndpoint.trim().length > 0) &&
    (translationProvider !== "custom-http" ||
      customTxEndpoint.trim().length > 0);

  const sameEndpoint =
    monitorEnabled &&
    inputEndpointId !== null &&
    playbackEndpointId !== null &&
    inputEndpointId === playbackEndpointId;

  const canStart =
    inputReady &&
    (!monitorEnabled || playbackReady) &&
    !sameEndpoint &&
    !busy &&
    !listening &&
    configComplete;

  const setInput = (value: string | null) => {
    setInputEndpointId(value);
    if (value === null) {
      window.localStorage.removeItem(INPUT_ENDPOINT_KEY);
    } else {
      window.localStorage.setItem(INPUT_ENDPOINT_KEY, value);
    }
  };

  const setPlayback = (value: string | null) => {
    setPlaybackEndpointId(value);
    if (value === null) {
      window.localStorage.removeItem(PLAYBACK_ENDPOINT_KEY);
    } else {
      window.localStorage.setItem(PLAYBACK_ENDPOINT_KEY, value);
    }
  };

  const toggleMonitor = () => {
    setMonitorEnabled((previous) => {
      const next = !previous;
      window.localStorage.setItem(MONITOR_ENABLED_KEY, String(next));
      return next;
    });
  };

  const changeSourceMode = (value: "filipino" | "chinese") => {
    setSourceMode(value);
    window.localStorage.setItem(SOURCE_MODE_KEY, value);
  };

  const changeAsrProvider = (value: AsrProvider) => {
    setAsrProvider(value);
    window.localStorage.setItem(ASR_PROVIDER_KEY, value);
  };

  const changeVadSensitivity = (value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setVadSensitivity(clamped);
    window.localStorage.setItem(VAD_SENSITIVITY_KEY, String(clamped));
  };

  const changeTranslationProvider = (value: TranslationProvider) => {
    setTranslationProvider(value);
    window.localStorage.setItem(TRANSLATION_PROVIDER_KEY, value);
    // Persist provider-specific configuration so it's already set when the
    // user swaps providers. Sidecar env vars are forwarded by the Rust bridge
    // at supervisor launch time.
    if (value === "libretranslate") {
      setEnvVar("LST_LT_ENDPOINT", ltEndpoint);
      setEnvVar("LST_LT_API_KEY", ltApiKey);
    } else if (value === "custom-http") {
      setEnvVar("LST_CUSTOM_TX_ENDPOINT", customTxEndpoint);
      setEnvVar("LST_CUSTOM_TX_API_KEY", customTxApiKey);
    }
  };

  return (
    <section className="card" id="live" aria-labelledby="live-title">
      <div className="card-head">
        <h2 className="card-title" id="live-title">
          Live
        </h2>
        <div
          className={`live-state ${listening ? "listening" : live.state}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {live.state === "starting"
            ? "Loading models"
            : live.state === "stopping"
              ? "Stopping"
              : listening
                ? "Listening"
                : live.state === "error"
                  ? "Needs attention"
                  : "Ready"}
        </div>
        {listening ? (
          <button
            className="button secondary live-stop"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void live.stop()}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" size={16} />
            ) : (
              <Square aria-hidden="true" size={14} />
            )}
            Stop listening
          </button>
        ) : (
          <button
            className="button primary live-start"
            type="button"
            disabled={!canStart}
            aria-busy={busy}
            onClick={() => {
              if (inputEndpointId !== null) {
                void (async () => {
                  await pushProviderEnv(asrProvider, translationProvider, {
                    groqApiKey,
                    ltEndpoint,
                    ltApiKey,
                    customTxEndpoint,
                    customTxApiKey,
                  });
                  await live.start(
                    inputEndpointId,
                    monitorEnabled ? playbackEndpointId : null,
                    asrProvider !== "groq-whisper" &&
                      translationProvider === "madlad"
                      ? (isSimulator ? "demo" : "local")
                      : "http",
                    monitorEnabled,
                    sourceMode,
                    asrProvider,
                    translationProvider,
                    vadSensitivity,
                  );
                })();
              }
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" size={16} />
            ) : (
              <Play aria-hidden="true" size={14} />
            )}
            {busy ? "Loading models…" : "Start listening"}
          </button>
        )}
      </div>

      {isSimulator && (
        <div className="inline-alert" role="status">
          <div>
            <strong>Simulator mode</strong>
            <p>Generated signal — real capture activates in the Windows build.</p>
          </div>
        </div>
      )}

      {live.error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>Live translation could not continue</strong>
            <p>{live.error}</p>
          </div>
        </div>
      )}

      <div className="live-grid">
        <div className="field span-2">
          <label htmlFor="live-input">Voice-chat channel</label>
          <select
            id="live-input"
            aria-label="Voice-chat channel"
            value={inputEndpointId ?? ""}
            disabled={listening || busy}
            onChange={(event) => {
              setInput(event.currentTarget.value || null);
            }}
          >
            <option value="">Choose incoming communications…</option>
            {captureInputs.length > 0 && (
              <optgroup label="Microphones (your voice)">
                {captureInputs.map((endpoint) => (
                  <option
                    key={endpoint.id}
                    value={endpoint.id}
                    disabled={endpoint.state !== "active"}
                  >
                    {endpoint.friendlyName}
                    {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {loopbackInputs.length > 0 && (
              <optgroup label="Loopback (game / teammate mix — no mic)">
                {loopbackInputs.map((endpoint) => (
                  <option
                    key={endpoint.id}
                    value={endpoint.id}
                    disabled={endpoint.state !== "active"}
                  >
                    {`${endpoint.friendlyName} · loopback`}
                    {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="field">
          <label htmlFor="live-language">Source language</label>
          <select
            id="live-language"
            aria-label="Source language"
            value={sourceMode}
            disabled={listening || busy}
            onChange={(event) => {
              changeSourceMode(
                event.currentTarget.value as "filipino" | "chinese",
              );
            }}
          >
            <option value="filipino">Filipino / Taglish</option>
            <option value="chinese">Chinese (Mandarin/Cantonese)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="live-asr">Speech recognition</label>
          <select
            id="live-asr"
            aria-label="Speech recognition source"
            value={asrProvider}
            disabled={listening || busy}
            onChange={(event) => {
              changeAsrProvider(event.currentTarget.value as AsrProvider);
            }}
          >
            <option value="whisper-turbo">Local Whisper large-v3-turbo (fast)</option>
            <option value="whisper-full">Local Whisper large-v3 (full)</option>
            <option value="ncspeech">NCSpeech FastConformer (Tagalog)</option>
            <option value="groq-whisper">Groq Whisper (free API)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="live-translation">Translation source</label>
          <select
            id="live-translation"
            aria-label="Translation source"
            value={translationProvider}
            disabled={listening || busy}
            onChange={(event) => {
              changeTranslationProvider(
                event.currentTarget.value as TranslationProvider,
              );
            }}
          >
            <option value="madlad">Local MADLAD (offline, private)</option>
            <option value="google-translate">
              Google Translate (free, unofficial endpoint)
            </option>
            <option value="libretranslate">
              LibreTranslate (any instance URL)
            </option>
            <option value="mymemory">MyMemory (free, daily quota)</option>
            <option value="custom-http">Custom HTTP endpoint</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="live-vad-sensitivity">
            Microphone sensitivity: {vadSensitivity}
          </label>
          <input
            id="live-vad-sensitivity"
            type="range"
            min={0}
            max={100}
            step={5}
            value={vadSensitivity}
            disabled={listening || busy}
            aria-label="Microphone sensitivity"
            onChange={(event) => {
              changeVadSensitivity(Number.parseInt(event.currentTarget.value, 10));
            }}
          />
        </div>
      </div>

      {asrProvider === "groq-whisper" && (
        <div className="live-http-config">
          <div className="field">
            <label htmlFor="groq-api-key">Groq API key</label>
            <input
              id="groq-api-key"
              type="password"
              placeholder="gsk_… (from console.groq.com/keys)"
              value={groqApiKey}
              disabled={listening || busy}
              onChange={(event) => {
                setGroqApiKey(event.currentTarget.value);
                setEnvVar("LST_GROQ_API_KEY", event.currentTarget.value);
              }}
            />
          </div>
        </div>
      )}

      {translationProvider === "libretranslate" && (
        <div className="live-http-config">
          <div className="field">
            <label htmlFor="lt-endpoint">LibreTranslate endpoint URL</label>
            <input
              id="lt-endpoint"
              type="url"
              placeholder="https://libretranslate.com/translate"
              value={ltEndpoint}
              disabled={listening || busy}
              onChange={(event) => {
                setLtEndpoint(event.currentTarget.value);
                setEnvVar("LST_LT_ENDPOINT", event.currentTarget.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="lt-api-key">API key (optional)</label>
            <input
              id="lt-api-key"
              type="password"
              placeholder="optional"
              value={ltApiKey}
              disabled={listening || busy}
              onChange={(event) => {
                setLtApiKey(event.currentTarget.value);
                setEnvVar("LST_LT_API_KEY", event.currentTarget.value);
              }}
            />
          </div>
        </div>
      )}

      {translationProvider === "custom-http" && (
        <div className="live-http-config">
          <div className="field">
            <label htmlFor="custom-tx-endpoint">Custom HTTP endpoint URL</label>
            <input
              id="custom-tx-endpoint"
              type="url"
              placeholder="https://api.example.com/translate"
              value={customTxEndpoint}
              disabled={listening || busy}
              onChange={(event) => {
                setCustomTxEndpoint(event.currentTarget.value);
                setEnvVar("LST_CUSTOM_TX_ENDPOINT", event.currentTarget.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="custom-tx-api-key">API key (optional)</label>
            <input
              id="custom-tx-api-key"
              type="password"
              placeholder="optional"
              value={customTxApiKey}
              disabled={listening || busy}
              onChange={(event) => {
                setCustomTxApiKey(event.currentTarget.value);
                setEnvVar(
                  "LST_CUSTOM_TX_API_KEY",
                  event.currentTarget.value,
                );
              }}
            />
          </div>
        </div>
      )}

      {!configComplete && (
        <div className="inline-alert" role="status">
          <div>
            <strong>Provider configuration needed</strong>
            <p>Enter the required API key or endpoint above.</p>
          </div>
        </div>
      )}

      <label className="live-monitor-toggle">
        <input
          type="checkbox"
          aria-label="Monitor captured audio (audible playback)"
          checked={monitorEnabled}
          disabled={listening || busy}
          onChange={toggleMonitor}
        />
        <span>
          <strong>Monitor captured audio</strong>
        </span>
      </label>

      {monitorEnabled && sameEndpoint && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>Capture and monitor use the same device</strong>
            <p>Pick a different playback device, or turn monitoring off.</p>
          </div>
        </div>
      )}

      {monitorEnabled && (
        <div className="field">
          <label htmlFor="live-playback">Monitoring output</label>
          <select
            id="live-playback"
            aria-label="Monitoring output"
            value={playbackEndpointId ?? ""}
            disabled={listening || busy}
            onChange={(event) => {
              setPlayback(event.currentTarget.value || null);
            }}
          >
            <option value="">Choose where to hear friends…</option>
            {audio.renderEndpoints.map((endpoint) => (
              <option
                key={endpoint.id}
                value={endpoint.id}
                disabled={endpoint.state !== "active"}
              >
                {endpoint.friendlyName}
                {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {(listening || live.lastCaption !== null) && (
        <div className="readout" aria-live="polite">
          {live.lastCaption === null ? (
            <p className="readout-empty">Listening for a complete phrase…</p>
          ) : (
            <>
              <p className="readout-source">{live.lastCaption.source_text}</p>
              <p className="readout-english">{live.lastCaption.english_text}</p>
            </>
          )}
          <dl className="metrics">
            <div>
              <dt>Captions</dt>
              <dd>{live.snapshot.metrics.captionsReceived}</dd>
            </div>
            <div>
              <dt>ASR</dt>
              <dd>
                {live.lastCaption === null
                  ? "—"
                  : `${String(Math.round(live.lastCaption.asr_ms))} ms`}
              </dd>
            </div>
            <div>
              <dt>Packets</dt>
              <dd>{live.snapshot.metrics.audioPacketsSent}</dd>
            </div>
            <div>
              <dt>Drops</dt>
              <dd>{live.snapshot.metrics.captureDrops}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
