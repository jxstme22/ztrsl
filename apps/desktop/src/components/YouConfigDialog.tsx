import { useEffect, useState } from "react";

import type { AudioEndpoint } from "../audio/model";
import {
  type YouStreamConfig,
  loadYouConfig,
  saveYouConfig,
} from "../you/config";
import {
  QUALITY_PROFILE_IDS,
  type QualityProfileId,
  loadQualityProfileId,
  saveQualityProfileId,
} from "../presets/quality";
import { useT } from "../features/i18n/store";
import type { SourceMode, TargetLanguage } from "../live/bridge";
import { Select } from "./Select";

import type { UIKey } from "../features/i18n/strings";

const SOURCE_MODES: readonly { value: SourceMode; label: UIKey }[] = [
  { value: "filipino", label: "langfilipino" },
  { value: "chinese", label: "langchinese" },
  { value: "english", label: "langenglish" },
  { value: "indonesian", label: "langindonesian" },
  { value: "vietnamese", label: "langvietnamese" },
  { value: "thai", label: "langthai" },
  { value: "malay", label: "langmalay" },
];

const TARGET_LANGUAGES: readonly { value: TargetLanguage; label: UIKey }[] = [
  { value: "en", label: "langen" },
  { value: "zh", label: "langzh" },
  { value: "fil", label: "langfil" },
  { value: "ind", label: "langind" },
  { value: "vie", label: "langvie" },
  { value: "tha", label: "langtha" },
  { value: "zsm", label: "langzsm" },
];

/** Keys the Live page uses (mirrored here so the modal edits the same
 * config the Live page reads). */
const LIVE_INPUT_ENDPOINT_KEY = "lst.live.input-endpoint";
const LIVE_SOURCE_MODE_KEY = "lst.live.source-mode";
const LIVE_TARGET_LANGUAGE_KEY = "lst.live.target-language";
const LIVE_ASR_PROVIDER_KEY = "lst.live.asr-provider";
const LIVE_TRANSLATION_PROVIDER_KEY = "lst.live.translation-provider";
const LIVE_VAD_SENSITIVITY_KEY = "lst.live.vad-sensitivity";
const LIVE_CAPTION_MODE_KEY = "lst.live.caption-mode";
const LIVE_SEGMENTATION_KEY = "lst.live.segmentation";
const GROQ_API_KEY_KEY = "lst.live.groq-api-key";
const NVIDIA_API_KEY_KEY = "lst.live.nvidia-api-key";
const LT_ENDPOINT_KEY = "lst.live.lt-endpoint";
const LT_API_KEY_KEY = "lst.live.lt-api-key";
const BAIDU_APPID_KEY = "lst.live.baidu-appid";
const BAIDU_SECRET_KEY = "lst.live.baidu-secret";
const CUSTOM_TX_ENDPOINT_KEY = "lst.live.custom-tx-endpoint";
const CUSTOM_TX_API_KEY_KEY = "lst.live.custom-tx-api-key";

/** Caption segmentation style: short chunks, balanced, or full sentences. */
type Segmentation = "chunk" | "balanced" | "sentence";

const SEGMENTATIONS: readonly Segmentation[] = ["chunk", "balanced", "sentence"];

type CaptionMode = "streaming" | "final-only";

function loadStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** ASR backends shown in the Live section (mirrors the Live page). */
const LIVE_ASR_OPTIONS: readonly {
  value: string;
  modelId: string | null;
  label: string;
}[] = [
  {
    value: "whisper-turbo",
    modelId: "whisper-large-v3-turbo",
    label: "Local Whisper large-v3-turbo (fast)",
  },
  {
    value: "whisper-full",
    modelId: "whisper-large-v3",
    label: "Local Whisper large-v3 (full)",
  },
  {
    value: "ncspeech",
    modelId: "ncspeech-tl-fastconformer-hybrid-large",
    label: "NCSpeech FastConformer (Tagalog)",
  },
  {
    value: "ncspeech-zh",
    modelId: "ncspeech-zh-citrinet-1024-gamma",
    label: "NCSpeech Citrinet-1024 (Mandarin)",
  },
  {
    value: "ncspeech-zh-parakeet",
    modelId: "ncspeech-zh-parakeet-ctc-0.6b",
    label: "NCSpeech Parakeet-CTC 0.6B (Mandarin)",
  },
  {
    value: "paraformer-zh-streaming",
    modelId: "paraformer-zh-streaming",
    label: "FunASR Paraformer (streaming zh)",
  },
  {
    value: "sensevoice-small",
    modelId: "sensevoice-small",
    label: "SenseVoice Small (zh/en/ja/ko/yue)",
  },
  {
    value: "nvidia-parakeet-1.1b",
    modelId: null,
    label: "NVIDIA Parakeet CTC 1.1B (NIM) · Cloud",
  },
  {
    value: "groq-whisper",
    modelId: null,
    label: "Groq Whisper (API) · Cloud",
  },
];

/** Translation backends shown in the Live section (mirrors the Live page). */
const LIVE_TRANSLATION_OPTIONS: readonly {
  value: string;
  modelId: string | null;
  label: string;
}[] = [
  {
    value: "nllb",
    modelId: "nllb-200-distilled-600M-ct2-int8",
    label: "Local NLLB (offline, near-real-time, GPU)",
  },
  {
    value: "madlad",
    modelId: "madlad400-3b-mt",
    label: "Local MADLAD (offline, slower)",
  },
  {
    value: "opus-mt-en-zh",
    modelId: "opus-mt-en-zh-ct2-int8",
    label: "Local opus-mt (en→zh)",
  },
  {
    value: "opus-mt-zh-en",
    modelId: "opus-mt-zh-en-ct2-int8",
    label: "Local opus-mt (zh→en)",
  },
  {
    value: "google-translate",
    modelId: null,
    label: "Google Translate (free, unofficial endpoint) · Cloud",
  },
  {
    value: "libretranslate",
    modelId: null,
    label: "LibreTranslate (any instance URL) · Cloud",
  },
  {
    value: "mymemory",
    modelId: null,
    label: "MyMemory (free, daily quota) · Cloud",
  },
  {
    value: "baidu-translate",
    modelId: null,
    label: "Baidu Translate (free, mainland China) · Cloud",
  },
  {
    value: "nvidia-riva-4b",
    modelId: null,
    label: "NVIDIA Riva Translate 4B (NIM) · Cloud",
  },
  {
    value: "custom-http",
    modelId: null,
    label: "Custom HTTP endpoint · Cloud",
  },
];

export function YouConfigDialog({
  endpoints,
  installedModelIds,
  onClose,
  onSaved,
}: {
  endpoints: AudioEndpoint[];
  installedModelIds: ReadonlySet<string>;
  onClose: () => void;
  onSaved: (config: YouStreamConfig) => void;
}) {
  const t = useT();
  const [config, setConfig] = useState<YouStreamConfig>(loadYouConfig);

  // Live section state, seeded from the same keys the Live page uses.
  const [liveEndpointId, setLiveEndpointId] = useState<string>(
    () => loadStored(LIVE_INPUT_ENDPOINT_KEY) ?? "",
  );
  const [liveSourceMode, setLiveSourceMode] = useState<SourceMode>(() => {
    const stored = loadStored(LIVE_SOURCE_MODE_KEY);
    return SOURCE_MODES.some((mode) => mode.value === stored)
      ? (stored as SourceMode)
      : "filipino";
  });
  const [liveTargetLanguage, setLiveTargetLanguage] = useState<TargetLanguage>(
    () => {
      const stored = loadStored(LIVE_TARGET_LANGUAGE_KEY);
      return TARGET_LANGUAGES.some((language) => language.value === stored)
        ? (stored as TargetLanguage)
        : "en";
    },
  );
  const [liveAsrProvider, setLiveAsrProvider] = useState<string>(
    () => loadStored(LIVE_ASR_PROVIDER_KEY) ?? "whisper-turbo",
  );
  const [liveTranslationProvider, setLiveTranslationProvider] =
    useState<string>(() => loadStored(LIVE_TRANSLATION_PROVIDER_KEY) ?? "nllb");
  const [liveQualityProfileId, setLiveQualityProfileId] =
    useState<QualityProfileId>(loadQualityProfileId);
  const [liveVadSensitivity, setLiveVadSensitivity] = useState<number>(() => {
    const stored = loadStored(LIVE_VAD_SENSITIVITY_KEY);
    const parsed = Number.parseInt(stored ?? "", 10);
    return Number.isFinite(parsed) ? parsed : 50;
  });
  const [liveCaptionMode, setLiveCaptionMode] = useState<CaptionMode>(() => {
    const stored = loadStored(LIVE_CAPTION_MODE_KEY);
    return stored === "final-only" ? "final-only" : "streaming";
  });
  const [liveSegmentation, setLiveSegmentation] = useState<Segmentation>(() => {
    const stored = loadStored(LIVE_SEGMENTATION_KEY);
    return SEGMENTATIONS.includes(stored as Segmentation)
      ? (stored as Segmentation)
      : "balanced";
  });
  // API credentials for the remote backends, persisted under the same keys
  // the Live page uses (so the separated session reuses them and the sidecar
  // env is pushed at start).
  const [nvidiaApiKey, setNvidiaApiKey] = useState<string>(
    () => loadStored(NVIDIA_API_KEY_KEY) ?? "",
  );
  const [groqApiKey, setGroqApiKey] = useState<string>(
    () => loadStored(GROQ_API_KEY_KEY) ?? "",
  );
  const [ltEndpoint, setLtEndpoint] = useState<string>(
    () => loadStored(LT_ENDPOINT_KEY) ?? "",
  );
  const [ltApiKey, setLtApiKey] = useState<string>(
    () => loadStored(LT_API_KEY_KEY) ?? "",
  );
  const [baiduAppId, setBaiduAppId] = useState<string>(
    () => loadStored(BAIDU_APPID_KEY) ?? "",
  );
  const [baiduSecret, setBaiduSecret] = useState<string>(
    () => loadStored(BAIDU_SECRET_KEY) ?? "",
  );
  const [customTxEndpoint, setCustomTxEndpoint] = useState<string>(
    () => loadStored(CUSTOM_TX_ENDPOINT_KEY) ?? "",
  );
  const [customTxApiKey, setCustomTxApiKey] = useState<string>(
    () => loadStored(CUSTOM_TX_API_KEY_KEY) ?? "",
  );

  const mics = endpoints.filter((endpoint) => endpoint.kind === "capture");
  const micOptions = mics.map((mic) => ({
    value: mic.id,
    label: mic.friendlyName,
  }));
  const liveEndpointOptions = endpoints
    .filter((endpoint) => endpoint.state === "active")
    .map((endpoint) => ({
      value: endpoint.id,
      label: endpoint.friendlyName,
    }));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const save = (applyLiveSeparately: boolean) => {
    saveYouConfig(config);
    if (applyLiveSeparately) {
      // Apply the Live section as a SEPARATE live config (different models
      // than the Live page). Otherwise the Live page's mode is kept.
      try {
        window.localStorage.setItem(LIVE_INPUT_ENDPOINT_KEY, liveEndpointId);
        window.localStorage.setItem(LIVE_SOURCE_MODE_KEY, liveSourceMode);
        window.localStorage.setItem(
          LIVE_TARGET_LANGUAGE_KEY,
          liveTargetLanguage,
        );
        window.localStorage.setItem(LIVE_ASR_PROVIDER_KEY, liveAsrProvider);
        window.localStorage.setItem(
          LIVE_TRANSLATION_PROVIDER_KEY,
          liveTranslationProvider,
        );
        window.localStorage.setItem(
          LIVE_VAD_SENSITIVITY_KEY,
          String(liveVadSensitivity),
        );
        window.localStorage.setItem(LIVE_CAPTION_MODE_KEY, liveCaptionMode);
        window.localStorage.setItem(LIVE_SEGMENTATION_KEY, liveSegmentation);
        saveQualityProfileId(liveQualityProfileId);
        window.localStorage.setItem(NVIDIA_API_KEY_KEY, nvidiaApiKey);
        window.localStorage.setItem(GROQ_API_KEY_KEY, groqApiKey);
        window.localStorage.setItem(LT_ENDPOINT_KEY, ltEndpoint);
        window.localStorage.setItem(LT_API_KEY_KEY, ltApiKey);
        window.localStorage.setItem(BAIDU_APPID_KEY, baiduAppId);
        window.localStorage.setItem(BAIDU_SECRET_KEY, baiduSecret);
        window.localStorage.setItem(CUSTOM_TX_ENDPOINT_KEY, customTxEndpoint);
        window.localStorage.setItem(CUSTOM_TX_API_KEY_KEY, customTxApiKey);
      } catch {
        // localStorage unavailable; the Live page keeps its own state.
      }
    }
    onSaved(config);
    onClose();
  };

  return (
    <div
      className="lst-modal-backdrop you-config-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("chatConfig")}
        className="lst-modal you-config-dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="lst-modal-head">
          <h3>{t("chatConfig")}</h3>
        </div>

        {/* ── You: the mic stream rides the live session; only the language
             pair (and which mic) differs from the live page. ── */}
        <section
          className="you-config-section"
          aria-labelledby="you-section-title"
        >
          <h4 id="you-section-title" className="you-config-section-title">
            {t("chatConfigYouSection")}
          </h4>
          <label className="field">
            <span>{t("chatConfigMic")}</span>
            <Select
              id="you-mic"
              label={t("chatConfigMic")}
              value={config.micEndpointId ?? ""}
              onChange={(value) => {
                setConfig({ ...config, micEndpointId: value || null });
              }}
              options={
                micOptions.length > 0
                  ? micOptions
                  : [{ value: "", label: t("chatConfigNoMic") }]
              }
              disabled={micOptions.length === 0}
            />
          </label>

          <div className="you-config-pair">
            <label className="field">
              <span>{t("chatConfigSource")}</span>
              <Select
                id="you-source"
                label={t("chatConfigSource")}
                value={config.sourceMode}
                onChange={(value) => {
                  setConfig({ ...config, sourceMode: value as SourceMode });
                }}
                options={SOURCE_MODES.map((mode) => ({
                  value: mode.value,
                  label: t(mode.label),
                }))}
              />
            </label>
            <label className="field">
              <span>{t("chatConfigTarget")}</span>
              <Select
                id="you-target"
                label={t("chatConfigTarget")}
                value={config.targetLanguage}
                onChange={(value) => {
                  setConfig({
                    ...config,
                    targetLanguage: value as TargetLanguage,
                  });
                }}
                options={TARGET_LANGUAGES.map((language) => ({
                  value: language.value,
                  label: t(language.label),
                }))}
              />
            </label>
          </div>
        </section>

        {/* ── Live translation: mirrors the Live page so users who want
             different models for the team stream can set them here. ── */}
        <section
          className="you-config-section"
          aria-labelledby="live-section-title"
        >
          <h4 id="live-section-title" className="you-config-section-title">
            {t("chatConfigLiveSection")}
          </h4>
          <label className="field">
            <span>{t("chatConfigLiveEndpoint")}</span>
            <Select
              id="live-endpoint"
              label={t("chatConfigLiveEndpoint")}
              value={liveEndpointId}
              onChange={(value) => {
                setLiveEndpointId(value);
              }}
              options={liveEndpointOptions}
            />
          </label>

          <div className="you-config-pair">
            <label className="field">
              <span>{t("chatConfigLiveSource")}</span>
              <Select
                id="live-source"
                label={t("chatConfigLiveSource")}
                value={liveSourceMode}
                onChange={(value) => {
                  setLiveSourceMode(value as SourceMode);
                }}
                options={SOURCE_MODES.map((mode) => ({
                  value: mode.value,
                  label: t(mode.label),
                }))}
              />
            </label>
            <label className="field">
              <span>{t("chatConfigLiveTarget")}</span>
              <Select
                id="live-target"
                label={t("chatConfigLiveTarget")}
                value={liveTargetLanguage}
                onChange={(value) => {
                  setLiveTargetLanguage(value as TargetLanguage);
                }}
                options={TARGET_LANGUAGES.map((language) => ({
                  value: language.value,
                  label: t(language.label),
                }))}
              />
            </label>
          </div>

          <label className="field">
            <span>{t("chatConfigAsr")}</span>
            <Select
              id="live-asr"
              label={t("chatConfigAsr")}
              value={liveAsrProvider}
              onChange={(value) => {
                setLiveAsrProvider(value);
              }}
              options={LIVE_ASR_OPTIONS.filter((option) => {
                // Only installed local models + always-visible cloud models.
                const localModel = option.modelId;
                return (
                  localModel === null || installedModelIds.has(localModel)
                );
              }).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </label>

          <label className="field">
            <span>{t("chatConfigTranslate")}</span>
            <Select
              id="live-translation"
              label={t("chatConfigTranslate")}
              value={liveTranslationProvider}
              onChange={(value) => {
                setLiveTranslationProvider(value);
              }}
              options={LIVE_TRANSLATION_OPTIONS.filter((option) => {
                const localModel = option.modelId;
                return (
                  localModel === null || installedModelIds.has(localModel)
                );
              }).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </label>

          <label className="field">
            <span>{t("liveQuality")}</span>
            <Select
              id="live-quality"
              label={t("liveQuality")}
              value={liveQualityProfileId}
              onChange={(value) => {
                setLiveQualityProfileId(value as QualityProfileId);
              }}
              options={QUALITY_PROFILE_IDS.map((id) => ({
                value: id,
                label: t(("liveQuality" + id) as UIKey),
              }))}
            />
          </label>

          <label className="field">
            <span>Microphone sensitivity: {liveVadSensitivity}</span>
            <input
              id="live-vad-sensitivity"
              type="range"
              min={0}
              max={100}
              step={5}
              value={liveVadSensitivity}
              aria-label="Microphone sensitivity"
              onChange={(event) => {
                setLiveVadSensitivity(
                  Number.parseInt(event.currentTarget.value, 10),
                );
              }}
            />
          </label>

          <label className="field">
            <span>{t("liveCaptionMode")}</span>
            <Select
              id="live-caption-mode"
              label={t("liveCaptionMode")}
              value={liveCaptionMode}
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
                setLiveCaptionMode(value as CaptionMode);
              }}
            />
            <small className="field-note">{t("liveCaptionModeNote")}</small>
          </label>

          <label className="field">
            <span>{t("liveSegmentation")}</span>
            <Select
              id="live-segmentation"
              label={t("liveSegmentation")}
              value={liveSegmentation}
              options={SEGMENTATIONS.map((id) => ({
                value: id,
                label: t(("liveSegmentation" + id) as UIKey),
              }))}
              onChange={(value) => {
                setLiveSegmentation(value as Segmentation);
              }}
            />
            <small className="field-note">
              {t(("liveSegmentationNote" + liveSegmentation) as UIKey)}
            </small>
          </label>

          {liveTranslationProvider === "opus-mt-en-zh" &&
            (liveSourceMode !== "english" ||
              liveTargetLanguage !== "zh") && (
              <p className="diag-hint warn">
                opus-mt (en→zh) needs the source set to English and the
                output language set to Chinese.
              </p>
            )}
          {liveTranslationProvider === "opus-mt-zh-en" &&
            (liveSourceMode !== "chinese" ||
              liveTargetLanguage !== "en") && (
              <p className="diag-hint warn">
                opus-mt (zh→en) needs the source set to Chinese and the
                output language set to English.
              </p>
            )}

          {(liveAsrProvider.startsWith("nvidia-") ||
            liveTranslationProvider.startsWith("nvidia-")) && (
            <label className="field">
              <span>{t("liveNvidiaApiKey")}</span>
              <input
                id="you-nvidia-api-key"
                type="password"
                placeholder="nvapi-… (from build.nvidia.com)"
                value={nvidiaApiKey}
                onChange={(event) => {
                  setNvidiaApiKey(event.currentTarget.value);
                }}
              />
            </label>
          )}

          {liveAsrProvider === "groq-whisper" && (
            <label className="field">
              <span>{t("liveGroqApiKey")}</span>
              <input
                id="you-groq-api-key"
                type="password"
                placeholder="gsk_… (from console.groq.com/keys)"
                value={groqApiKey}
                onChange={(event) => {
                  setGroqApiKey(event.currentTarget.value);
                }}
              />
            </label>
          )}

          {liveTranslationProvider === "libretranslate" && (
            <>
              <label className="field">
                <span>{t("liveLibreTranslateUrl")}</span>
                <input
                  id="you-lt-endpoint"
                  type="url"
                  placeholder="https://libretranslate.com/translate"
                  value={ltEndpoint}
                  onChange={(event) => {
                    setLtEndpoint(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="field">
                <span>{t("liveApiKeyOptional")}</span>
                <input
                  id="you-lt-api-key"
                  type="password"
                  placeholder="optional"
                  value={ltApiKey}
                  onChange={(event) => {
                    setLtApiKey(event.currentTarget.value);
                  }}
                />
              </label>
            </>
          )}

          {liveTranslationProvider === "baidu-translate" && (
            <>
              <label className="field">
                <span>{t("liveBaiduAppId")}</span>
                <input
                  id="you-baidu-appid"
                  type="text"
                  placeholder="2025..."
                  value={baiduAppId}
                  onChange={(event) => {
                    setBaiduAppId(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="field">
                <span>{t("liveBaiduSecret")}</span>
                <input
                  id="you-baidu-secret"
                  type="password"
                  value={baiduSecret}
                  onChange={(event) => {
                    setBaiduSecret(event.currentTarget.value);
                  }}
                />
              </label>
            </>
          )}

          {liveTranslationProvider === "custom-http" && (
            <>
              <label className="field">
                <span>{t("liveCustomHttp")}</span>
                <input
                  id="you-custom-tx-endpoint"
                  type="url"
                  placeholder="https://api.example.com/translate"
                  value={customTxEndpoint}
                  onChange={(event) => {
                    setCustomTxEndpoint(event.currentTarget.value);
                  }}
                />
              </label>
              <label className="field">
                <span>{t("liveApiKeyOptional")}</span>
                <input
                  id="you-custom-tx-api-key"
                  type="password"
                  placeholder="optional"
                  value={customTxApiKey}
                  onChange={(event) => {
                    setCustomTxApiKey(event.currentTarget.value);
                  }}
                />
              </label>
            </>
          )}
        </section>

        <p className="you-config-live-note">{t("chatConfigLiveNote")}</p>

        <div className="lst-modal-actions you-config-actions">
          <button type="button" className="button quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="button primary btn-shine"
            onClick={() => {
              save(true);
            }}
          >
            {t("chatConfigSaveSeparate")}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              save(false);
            }}
          >
            {t("chatConfigSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
