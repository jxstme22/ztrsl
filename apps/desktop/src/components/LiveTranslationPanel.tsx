import { LoaderCircle, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import { useLiveTranslation } from "../live/useLiveTranslation";
import { setTranslationEnv } from "../live/bridge";
import type {
  AsrProvider,
  SourceMode,
  TargetLanguage,
  TranslationProvider,
} from "../live/bridge";
import type { ModelUiState } from "../models/useModels";
import { useT } from "../features/i18n/store";
import type { UIKey } from "../features/i18n/strings";
import { loadSourceConfigs } from "../sources/storage";
import { Select } from "./Select";
import type { SelectOption } from "./Select";

type AudioController = ReturnType<typeof useAudioMeter>;
type LiveController = ReturnType<typeof useLiveTranslation>;

type LiveTranslationPanelProps = {
  audio: AudioController;
  live: LiveController;
  /** Installed model ids, so provider options can show what's on disk. */
  models?: ModelUiState;
};

const INPUT_ENDPOINT_KEY = "lst.live.input-endpoint";
const PLAYBACK_ENDPOINT_KEY = "lst.live.playback-endpoint";
const MONITOR_ENABLED_KEY = "lst.live.monitor";
const SOURCE_MODE_KEY = "lst.live.source-mode";
const TARGET_LANGUAGE_KEY = "lst.live.target-language";
const ASR_PROVIDER_KEY = "lst.live.asr-provider";
const VAD_SENSITIVITY_KEY = "lst.live.vad-sensitivity";
const GROQ_API_KEY_KEY = "lst.live.groq-api-key";
const TRANSLATION_PROVIDER_KEY = "lst.live.translation-provider";
const LT_ENDPOINT_KEY = "lst.live.lt-endpoint";
const LT_API_KEY_KEY = "lst.live.lt-api-key";
const CUSTOM_TX_ENDPOINT_KEY = "lst.live.custom-tx-endpoint";
const CUSTOM_TX_API_KEY_KEY = "lst.live.custom-tx-api-key";
const CAPTION_MODE_KEY = "lst.live.caption-mode";

/** How the pipeline produces captions: streaming preview vs per-utterance. */
export type CaptionMode = "streaming" | "final-only";

function loadCaptionMode(): CaptionMode {
  const stored = window.localStorage.getItem(CAPTION_MODE_KEY);
  return stored === "final-only" ? "final-only" : "streaming";
}

function loadStored(key: string): string | null {
  return window.localStorage.getItem(key);
}

function loadMonitorEnabled(): boolean {
  return window.localStorage.getItem(MONITOR_ENABLED_KEY) === "true";
}

const SOURCE_MODES: readonly SourceMode[] = [
  "filipino",
  "chinese",
  "english",
  "indonesian",
  "vietnamese",
  "thai",
  "malay",
];

const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  "en",
  "zh",
  "fil",
  "ind",
  "vie",
  "tha",
  "zsm",
];

function loadSourceMode(): SourceMode {
  const stored = window.localStorage.getItem(SOURCE_MODE_KEY);
  return SOURCE_MODES.includes(stored as SourceMode)
    ? (stored as SourceMode)
    : "filipino";
}

function loadTargetLanguage(): TargetLanguage {
  const stored = window.localStorage.getItem(TARGET_LANGUAGE_KEY);
  return TARGET_LANGUAGES.includes(stored as TargetLanguage)
    ? (stored as TargetLanguage)
    : "en";
}

function loadAsrProvider(): AsrProvider {
  const stored = window.localStorage.getItem(ASR_PROVIDER_KEY);
  if (
    stored === "whisper-turbo" ||
    stored === "whisper-full" ||
    stored === "ncspeech" ||
    stored === "ncspeech-zh" ||
    stored === "ncspeech-zh-parakeet" ||
    stored === "paraformer-zh-streaming" ||
    stored === "sensevoice-small" ||
    stored === "mlx" ||
    stored === "mlx-whisper" ||
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
    stored === "nllb" ||
    stored === "madlad" ||
    stored === "opus-mt-en-zh" ||
    stored === "opus-mt-zh-en" ||
    stored === "libretranslate" ||
    stored === "google-translate" ||
    stored === "mymemory" ||
    stored === "custom-http"
  ) {
    return stored;
  }
  return "nllb";
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
    captionMode: CaptionMode;
  },
): Promise<void> {
  const pairs: [string, string][] = [];
  pairs.push(["LST_CAPTION_MODE", config.captionMode]);
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
  live,
  models,
}: LiveTranslationPanelProps) {
  const [inputEndpointId, setInputEndpointId] = useState<string | null>(() =>
    loadStored(INPUT_ENDPOINT_KEY),
  );
  const [playbackEndpointId, setPlaybackEndpointId] = useState<string | null>(
    () => loadStored(PLAYBACK_ENDPOINT_KEY),
  );
  const [monitorEnabled, setMonitorEnabled] =
    useState<boolean>(loadMonitorEnabled);
  const [sourceMode, setSourceMode] = useState<SourceMode>(loadSourceMode);
  const [targetLanguage, setTargetLanguage] =
    useState<TargetLanguage>(loadTargetLanguage);
  const [asrProvider, setAsrProvider] = useState<AsrProvider>(loadAsrProvider);
  const [vadSensitivity, setVadSensitivity] =
    useState<number>(loadVadSensitivity);
  const [captionMode, setCaptionMode] = useState<CaptionMode>(loadCaptionMode);
  const [groqApiKey, setGroqApiKey] = useState<string>(
    () => window.localStorage.getItem(GROQ_API_KEY_KEY) ?? "",
  );
  const [translationProvider, setTranslationProvider] =
    useState<TranslationProvider>(loadTranslationProvider);
  // Single-channel vs all-sources: all-sources starts one live session that
  // captures every configured source with its own tag.
  const [channelMode, setChannelMode] = useState<"channel" | "all">("channel");
  const configurableSources = useMemo(
    () =>
      loadSourceConfigs().sources.filter(
        (source) =>
          source.captureTarget.kind === "endpoint" &&
          source.captureTarget.endpointId !== null,
      ),
    [],
  );
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
  // Persist API keys and custom endpoints on change: the inputs below only
  // set React state, and navigating away unmounts the panel — without these
  // effects everything typed would be lost on the next page switch.
  useEffect(() => {
    setEnvVar(GROQ_API_KEY_KEY, groqApiKey);
  }, [groqApiKey]);
  useEffect(() => {
    setEnvVar(LT_API_KEY_KEY, ltApiKey);
  }, [ltApiKey]);
  useEffect(() => {
    setEnvVar(LT_ENDPOINT_KEY, ltEndpoint);
  }, [ltEndpoint]);
  useEffect(() => {
    setEnvVar(CUSTOM_TX_ENDPOINT_KEY, customTxEndpoint);
  }, [customTxEndpoint]);
  useEffect(() => {
    setEnvVar(CUSTOM_TX_API_KEY_KEY, customTxApiKey);
  }, [customTxApiKey]);
  const t = useT();
  const isSimulator = audio.catalog?.platform === "development";
  const busy = live.state === "starting" || live.state === "stopping";
  const listening = live.state === "listening";

  const endpoints = audio.catalog?.endpoints ?? [];
  const isMacos = audio.catalog?.platform === "macos";
  // On Windows, loopback captures a render endpoint (WASAPI loopback). On
  // macOS, BlackHole exposes its input as a capture endpoint — the game
  // routes voice-chat output to BlackHole, and we capture that input.
  const captureInputs = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === "capture"),
    [endpoints],
  );
  const loopbackInputs = useMemo(
    () =>
      isMacos
        ? endpoints.filter(
            (endpoint) =>
              endpoint.kind === "capture" &&
              /blackhole|black hole/i.test(endpoint.friendlyName),
          )
        : endpoints.filter((endpoint) => endpoint.kind === "render"),
    [endpoints, isMacos],
  );

  // Installed local model ids (whisper/nllb/madlad on disk) plus the known
  // NCSpeech exports, so the provider list can honestly tag what's available
  // vs. what still needs downloading/exporting.
  const installedModelIds = useMemo(() => {
    const installed = new Set<string>();
    for (const model of models?.installed ?? []) {
      installed.add(model.id);
    }
    for (const model of models?.knownInstalled ?? []) {
      installed.add(model.id);
    }
    return installed;
  }, [models?.installed, models?.knownInstalled]);

  const tag = (label: string, installed: boolean): string =>
    installed ? label : `${label} (${t("liveNotInstalled")})`;

  /** Mark a cloud/API provider so it is clearly distinct from local ones. */
  const cloud = (label: string): string => `${label} · Cloud`;

  const channelOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [];
    const activeCapture = captureInputs.filter(
      (endpoint) => endpoint.state === "active",
    );
    const activeLoopback = loopbackInputs.filter(
      (endpoint) => endpoint.state === "active",
    );
    if (activeCapture.length > 0) {
      options.push(
        ...activeCapture.map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.friendlyName,
          group: "Microphones (your voice)",
        })),
      );
    }
    if (activeLoopback.length > 0) {
      options.push(
        ...activeLoopback.map((endpoint) => ({
          value: endpoint.id,
          label: `${endpoint.friendlyName} · loopback`,
          group: "Loopback (game / teammate mix — no mic)",
        })),
      );
    }
    return options;
  }, [captureInputs, loopbackInputs]);

  const selectedInput =
    endpoints.find((endpoint) => endpoint.id === inputEndpointId) ?? null;
  const inputReady = selectedInput !== null && selectedInput.state === "active";

  const playbackEndpoint =
    endpoints.find(
      (endpoint) =>
        endpoint.id === playbackEndpointId && endpoint.kind === "render",
    ) ?? null;
  const playbackReady =
    playbackEndpoint !== null && playbackEndpoint.state === "active";

  const configComplete =
    (asrProvider !== "groq-whisper" || groqApiKey.trim().length > 0) &&
    (translationProvider !== "libretranslate" ||
      ltEndpoint.trim().length > 0) &&
    (translationProvider !== "custom-http" ||
      customTxEndpoint.trim().length > 0) &&
    (translationProvider !== "opus-mt-en-zh" ||
      (sourceMode === "english" && targetLanguage === "zh")) &&
    (translationProvider !== "opus-mt-zh-en" ||
      (sourceMode === "chinese" && targetLanguage === "en"));

  const sameEndpoint =
    monitorEnabled &&
    inputEndpointId !== null &&
    playbackEndpointId !== null &&
    inputEndpointId === playbackEndpointId;

  const allSources = channelMode === "all" ? configurableSources : [];
  const canStart =
    (channelMode === "all"
      ? allSources.length > 0
      : inputReady && !sameEndpoint) &&
    (!monitorEnabled || playbackReady || channelMode === "all") &&
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

  const changeSourceMode = (value: SourceMode) => {
    setSourceMode(value);
    window.localStorage.setItem(SOURCE_MODE_KEY, value);
  };

  const changeTargetLanguage = (value: TargetLanguage) => {
    setTargetLanguage(value);
    window.localStorage.setItem(TARGET_LANGUAGE_KEY, value);
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

  const changeCaptionMode = (value: CaptionMode) => {
    setCaptionMode(value);
    window.localStorage.setItem(CAPTION_MODE_KEY, value);
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
            ? t("liveLoadingModels")
            : live.state === "stopping"
              ? t("liveStopping")
              : listening
                ? t("liveStop")
                : live.state === "error"
                  ? t("liveNeedsAttention")
                  : t("liveStart")}
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
            {t("liveStopListening")}
          </button>
        ) : (
          <button
            className="button primary live-start"
            type="button"
            disabled={!canStart}
            aria-busy={busy}
            onClick={() => {
              const activeSources =
                channelMode === "all" ? allSources : [];
              if (
                channelMode === "all"
                  ? activeSources.length > 0
                  : inputEndpointId !== null
              ) {
                void (async () => {
                  await pushProviderEnv(asrProvider, translationProvider, {
                    groqApiKey,
                    ltEndpoint,
                    ltApiKey,
                    customTxEndpoint,
                    customTxApiKey,
                    captionMode,
                  });
                  const firstEndpoint =
                    activeSources[0]?.captureTarget.kind === "endpoint"
                      ? activeSources[0].captureTarget.endpointId
                      : null;
                  await live.start(
                    channelMode === "all"
                      ? firstEndpoint ?? ""
                      : (inputEndpointId ?? ""),
                    channelMode === "all"
                      ? null
                      : monitorEnabled
                        ? playbackEndpointId
                        : null,
                    asrProvider !== "groq-whisper" &&
                      (translationProvider === "madlad" ||
                        translationProvider === "nllb" ||
                        translationProvider === "opus-mt-en-zh" ||
                        translationProvider === "opus-mt-zh-en")
                      ? isSimulator
                        ? "demo"
                        : "local"
                      : "http",
                    channelMode === "all" ? false : monitorEnabled,
                    sourceMode,
                    targetLanguage,
                    asrProvider,
                    translationProvider,
                    vadSensitivity,
                    activeSources.map((source) => ({
                      sourceId: source.sourceId,
                      endpointId:
                        source.captureTarget.kind === "endpoint"
                          ? (source.captureTarget.endpointId ?? "")
                          : "",
                      displayName: source.displayName,
                      captionTag: source.captionTag,
                      languageProfile: source.languageProfile,
                      strictness: source.strictness,
                      labelStyle: source.labelStyle,
                      color: source.color,
                    })),
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
            {busy ? t("liveLoadingModels") : t("liveStartListening")}
          </button>
        )}
      </div>

      {isSimulator && (
        <div className="inline-alert" role="status">
          <div>
            <strong>{t("liveSimulatorMode")}</strong>
            <p>{t("liveSimulatorModeText")}</p>
          </div>
        </div>
      )}

      {live.error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>{t("liveCouldNotContinue")}</strong>
            <p>{live.error}</p>
          </div>
        </div>
      )}

      {live.warning !== null && live.error === null && (
        <div className="inline-alert warn" role="status">
          <div>
            <strong>{t("liveAudioStalled")}</strong>
            <p>{live.warning}</p>
          </div>
        </div>
      )}

      <div className="live-grid">
        {configurableSources.length >= 2 && (
          <div className="field span-2">
            <label htmlFor="live-channel-mode">{t("liveChannelMode")}</label>
            <div className="segmented" id="live-channel-mode">
              <button
                type="button"
                className={channelMode === "channel" ? "on" : ""}
                disabled={listening || busy}
                onClick={() => {
                  setChannelMode("channel");
                }}
              >
                {t("liveOneChannel")}
              </button>
              <button
                type="button"
                className={channelMode === "all" ? "on" : ""}
                disabled={listening || busy}
                onClick={() => {
                  setChannelMode("all");
                }}
              >
                {t("liveAllSources").replace(
                  "{count}",
                  String(configurableSources.length),
                )}
              </button>
            </div>
            <small className="field-note">
              {channelMode === "all"
                ? t("liveAllSourcesNote")
                : t("liveOneChannelNote")}
            </small>
          </div>
        )}
        {channelMode === "all" ? (
          <div className="field span-2">
            <label>{t("liveSourcesBeingCaptured")}</label>
            <ul className="live-source-list">
              {allSources.map((source) => (
                <li key={source.sourceId}>
                  <span className="live-source-tag">{source.captionTag}</span>
                  <span className="live-source-name">
                    {source.displayName}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="field span-2">
            <label htmlFor="live-input">{t("liveVoiceChatChannel")}</label>
            <Select
              id="live-input"
              label={t("liveVoiceChatChannel")}
              value={inputEndpointId ?? ""}
              options={channelOptions}
              disabled={listening || busy}
              placeholder={t("liveChooseInput")}
              onChange={(value) => {
                setInput(value || null);
              }}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="live-language">{t("liveSourceLanguage")}</label>
          <Select
            id="live-language"
            label={t("liveSourceLanguage")}
            value={sourceMode}
            disabled={listening || busy}
            onChange={(value) => {
              changeSourceMode(value as SourceMode);
            }}
            options={SOURCE_MODES.map((mode) => ({
              value: mode,
              label: t(("lang" + mode) as UIKey),
            }))}
          />
        </div>

        <div className="field">
          <label htmlFor="live-target-language">
            {t("liveOutputLanguage")}
          </label>
          <Select
            id="live-target-language"
            label={t("liveOutputLanguage")}
            value={targetLanguage}
            disabled={listening || busy}
            onChange={(value) => {
              changeTargetLanguage(value as TargetLanguage);
            }}
            options={TARGET_LANGUAGES.map((language) => ({
              value: language,
              label: t(("lang" + language) as UIKey),
            }))}
          />
        </div>

        <div className="field">
          <label htmlFor="live-asr">{t("liveSpeechRecognition")}</label>
          <Select
            id="live-asr"
            label={t("liveSpeechRecognitionSource")}
            value={asrProvider}
            disabled={listening || busy}
            onChange={(value) => {
              changeAsrProvider(value as AsrProvider);
            }}
            options={[
              {
                value: "whisper-turbo",
                label: tag(
                  "Local Whisper large-v3-turbo (fast)",
                  installedModelIds.has("whisper-large-v3-turbo"),
                ),
              },
              {
                value: "whisper-full",
                label: tag(
                  "Local Whisper large-v3 (full)",
                  installedModelIds.has("whisper-large-v3"),
                ),
              },
              ...(audio.catalog?.platform === "macos"
                ? [
                    {
                      value: "mlx" as const,
                      label: tag(
                        "Apple Silicon Whisper (Metal, recommended on Mac)",
                        installedModelIds.has("mlx-whisper-large-v3-turbo-q4"),
                      ),
                    },
                  ]
                : []),
              {
                value: "ncspeech",
                label: tag(
                  "NCSpeech FastConformer (Tagalog)",
                  installedModelIds.has(
                    "ncspeech-tl-fastconformer-hybrid-large",
                  ),
                ),
              },
              {
                value: "ncspeech-zh",
                label: tag(
                  "NCSpeech Citrinet-1024 (Mandarin)",
                  installedModelIds.has("ncspeech-zh-citrinet-1024-gamma"),
                ),
              },
              {
                value: "ncspeech-zh-parakeet",
                label: tag(
                  "NCSpeech Parakeet-CTC 0.6B (Mandarin)",
                  installedModelIds.has("ncspeech-zh-parakeet-ctc-0.6b"),
                ),
              },
              {
                value: "paraformer-zh-streaming",
                label: tag(
                  "FunASR Paraformer (streaming zh)",
                  installedModelIds.has("paraformer-zh-streaming"),
                ),
              },
              {
                value: "sensevoice-small",
                label: tag(
                  "SenseVoice Small (zh/en/ja/ko/yue)",
                  installedModelIds.has("sensevoice-small"),
                ),
              },
              { value: "groq-whisper", label: cloud("Groq Whisper (API)") },
            ]}
          />
        </div>

        <div className="field">
          <label htmlFor="live-translation">{t("liveTranslationSource")}</label>
          <Select
            id="live-translation"
            label={t("liveTranslationSource")}
            value={translationProvider}
            disabled={listening || busy}
            onChange={(value) => {
              changeTranslationProvider(value as TranslationProvider);
            }}
            options={[
              {
                value: "nllb",
                label: tag(
                  "Local NLLB (offline, near-real-time, GPU)",
                  installedModelIds.has("nllb-200-distilled-600M-ct2-int8"),
                ),
              },
              {
                value: "madlad",
                label: tag(
                  "Local MADLAD (offline, slower)",
                  installedModelIds.has("madlad400-3b-mt"),
                ),
              },
              {
                value: "opus-mt-en-zh",
                label: tag(
                  "Local opus-mt (en→zh, Apache-2.0)",
                  installedModelIds.has("opus-mt-en-zh-ct2-int8"),
                ),
              },
              {
                value: "opus-mt-zh-en",
                label: tag(
                  "Local opus-mt (zh→en, Apache-2.0)",
                  installedModelIds.has("opus-mt-zh-en-ct2-int8"),
                ),
              },
              {
                value: "google-translate",
                label: cloud("Google Translate (free, unofficial endpoint)"),
              },
              {
                value: "libretranslate",
                label: cloud("LibreTranslate (any instance URL)"),
              },
              {
                value: "mymemory",
                label: cloud("MyMemory (free, daily quota)"),
              },
              { value: "custom-http", label: cloud(t("liveCustomHttp")) },
            ]}
          />
          {translationProvider === "opus-mt-en-zh" &&
            (sourceMode !== "english" || targetLanguage !== "zh") && (
              <p className="diag-hint warn">
                opus-mt (en→zh) needs the source set to English and the
                output language set to Chinese.
              </p>
            )}
          {translationProvider === "opus-mt-zh-en" &&
            (sourceMode !== "chinese" || targetLanguage !== "en") && (
              <p className="diag-hint warn">
                opus-mt (zh→en) needs the source set to Chinese and the
                output language set to English.
              </p>
            )}
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
              changeVadSensitivity(
                Number.parseInt(event.currentTarget.value, 10),
              );
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="live-caption-mode">{t("liveCaptionMode")}</label>
          <Select
            id="live-caption-mode"
            label={t("liveCaptionMode")}
            value={captionMode}
            options={[
              {
                value: "streaming",
                label: t("liveCaptionModeStreaming"),
              },
              {
                value: "final-only",
                label: t("liveCaptionModeFinal"),
              },
            ]}
            onChange={(value) => {
              changeCaptionMode(value as CaptionMode);
            }}
          />
          <small className="field-note">{t("liveCaptionModeNote")}</small>
        </div>
      </div>

      {asrProvider === "groq-whisper" && (
        <div className="live-http-config">
          <div className="field">
            <label htmlFor="groq-api-key">{t("liveGroqApiKey")}</label>
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
            <small className="field-note">
              Groq's Whisper runs in the cloud — audio is sent to Groq while
              this option is selected. Get a free key:
            </small>
            <ol className="lst-key-steps">
              <li>
                Create a free account at <code>console.groq.com</code>.
              </li>
              <li>
                Open <code>console.groq.com/keys</code> → “Create API Key”.
              </li>
              <li>
                Copy the <code>gsk_…</code> key here and press Start.
              </li>
            </ol>
          </div>
        </div>
      )}

      {translationProvider === "libretranslate" && (
        <div className="live-http-config">
          <div className="field">
            <label htmlFor="lt-endpoint">{t("liveLibreTranslateUrl")}</label>
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
            <label htmlFor="lt-api-key">{t("liveApiKeyOptional")}</label>
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
            <label htmlFor="custom-tx-endpoint">{t("liveCustomHttpUrl")}</label>
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
                setEnvVar("LST_CUSTOM_TX_API_KEY", event.currentTarget.value);
              }}
            />
          </div>
        </div>
      )}

      {!configComplete && (
        <div className="inline-alert" role="status">
          <div>
            <strong>{t("liveProviderConfigNeeded")}</strong>
            <p>Enter the required API key or endpoint above.</p>
          </div>
        </div>
      )}

      {channelMode !== "all" && (
        <label className="live-monitor-toggle">
          <input
            type="checkbox"
            aria-label={t("liveMonitorCapturedAudio")}
            checked={monitorEnabled}
            disabled={listening || busy}
            onChange={toggleMonitor}
          />
          <span>
            <strong>{t("liveMonitorCapturedAudio")}</strong>
          </span>
        </label>
      )}

      {monitorEnabled && sameEndpoint && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>{t("liveSameDeviceWarning")}</strong>
            <p>Pick a different playback device, or turn monitoring off.</p>
          </div>
        </div>
      )}

      {monitorEnabled && (
        <div className="field">
          <label htmlFor="live-playback">{t("liveMonitoringOutput")}</label>
          <Select
            id="live-playback"
            label={t("liveMonitoringOutput")}
            value={playbackEndpointId ?? ""}
            disabled={listening || busy}
            placeholder="Choose where to hear friends…"
            onChange={(value) => {
              setPlayback(value || null);
            }}
            options={audio.renderEndpoints
              .filter((endpoint) => endpoint.state === "active")
              .map((endpoint) => ({
                value: endpoint.id,
                label: endpoint.friendlyName,
              }))}
          />
        </div>
      )}

      {(listening || live.lastCaption !== null) && (
        <div className="readout" aria-live="polite">
          {live.lastCaption === null ? (
            <p className="readout-empty">{t("liveListeningForPhrase")}</p>
          ) : (
            <>
              <p className="readout-source">{live.lastCaption.source_text}</p>
              <p className="readout-english">{live.lastCaption.english_text}</p>
            </>
          )}
          <dl className="metrics">
            <div>
              <dt>{t("liveDevice")}</dt>
              <dd>{live.snapshot.asrRuntime ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("liveCaptions")}</dt>
              <dd>{live.snapshot.metrics.captionsReceived}</dd>
            </div>
            <div>
              <dt>{t("liveAsrLabel")}</dt>
              <dd>
                {live.lastCaption === null
                  ? "—"
                  : `${String(Math.round(live.lastCaption.asr_ms))} ms`}
              </dd>
            </div>
            <div>
              <dt>{t("livePackets")}</dt>
              <dd>{live.snapshot.metrics.audioPacketsSent}</dd>
            </div>
            <div>
              <dt>{t("liveDrops")}</dt>
              <dd>{live.snapshot.metrics.captureDrops}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
