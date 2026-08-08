import { useEffect, useState } from "react";

import type { AudioEndpoint } from "../audio/model";
import {
  type YouStreamConfig,
  loadYouConfig,
  saveYouConfig,
} from "../you/config";
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

function loadStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** ASR backends shown in the Live section (mirrors the Live page). */
const LIVE_ASR_OPTIONS: readonly { value: string; modelId: string | null }[] = [
  { value: "whisper-turbo", modelId: "whisper-large-v3-turbo" },
  { value: "whisper-full", modelId: "whisper-large-v3" },
  { value: "mlx-whisper", modelId: "mlx-whisper-large-v3-turbo-q4" },
  { value: "ncspeech", modelId: "ncspeech-tl-fastconformer-hybrid-large" },
  { value: "ncspeech-zh", modelId: "ncspeech-zh-citrinet-1024-gamma" },
  { value: "ncspeech-zh-parakeet", modelId: "ncspeech-zh-parakeet-ctc-0.6b" },
  { value: "paraformer-zh-streaming", modelId: "paraformer-zh-streaming" },
  { value: "sensevoice-small", modelId: "sensevoice-small" },
  { value: "nvidia-parakeet-1.1b", modelId: null },
  { value: "groq-whisper", modelId: null },
];

/** Translation backends shown in the Live section (mirrors the Live page). */
const LIVE_TRANSLATION_OPTIONS: readonly { value: string; modelId: string | null }[] = [
  { value: "nllb", modelId: "nllb-200-distilled-600M-ct2-int8" },
  { value: "madlad", modelId: "madlad400-3b-mt" },
  { value: "opus-mt-en-zh", modelId: "opus-mt-en-zh-ct2-int8" },
  { value: "opus-mt-zh-en", modelId: "opus-mt-zh-en-ct2-int8" },
  { value: "google-translate", modelId: null },
  { value: "libretranslate", modelId: null },
  { value: "mymemory", modelId: null },
  { value: "baidu-translate", modelId: null },
  { value: "nvidia-riva-4b", modelId: null },
  { value: "custom-http", modelId: null },
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
    useState<string>(
      () => loadStored(LIVE_TRANSLATION_PROVIDER_KEY) ?? "nllb",
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
    return () => { document.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const save = (applyLiveSeparately: boolean) => {
    saveYouConfig(config);
    if (applyLiveSeparately) {
      // Apply the Live section as a SEPARATE live config (different models
      // than the Live page). Otherwise the Live page's mode is kept.
      try {
        window.localStorage.setItem(LIVE_INPUT_ENDPOINT_KEY, liveEndpointId);
        window.localStorage.setItem(LIVE_SOURCE_MODE_KEY, liveSourceMode);
        window.localStorage.setItem(LIVE_TARGET_LANGUAGE_KEY, liveTargetLanguage);
        window.localStorage.setItem(LIVE_ASR_PROVIDER_KEY, liveAsrProvider);
        window.localStorage.setItem(
          LIVE_TRANSLATION_PROVIDER_KEY,
          liveTranslationProvider,
        );
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
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="lst-modal-head">
          <h3>{t("chatConfig")}</h3>
        </div>

        {/* ── You: the mic stream rides the live session; only the language
             pair (and which mic) differs from the live page. ── */}
        <section className="you-config-section" aria-labelledby="you-section-title">
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

          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={config.autoReverse}
                onChange={(event) => {
                  setConfig({ ...config, autoReverse: event.target.checked });
                }}
              />
              {t("chatConfigAuto")}
            </span>
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
        <section className="you-config-section" aria-labelledby="live-section-title">
          <h4 id="live-section-title" className="you-config-section-title">
            {t("chatConfigLiveSection")}
          </h4>
          <label className="field">
            <span>{t("chatConfigLiveEndpoint")}</span>
            <Select
              id="live-endpoint"
              label={t("chatConfigLiveEndpoint")}
              value={liveEndpointId}
              onChange={(value) => { setLiveEndpointId(value); }}
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
              onChange={(value) => { setLiveAsrProvider(value); }}
              options={LIVE_ASR_OPTIONS.map((option) => {
                const notInstalled =
                  option.modelId !== null &&
                  !installedModelIds.has(option.modelId);
                return {
                  value: option.value,
                  label: option.value,
                  ...(notInstalled ? { group: t("liveNotInstalled") } : {}),
                };
              })}
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
              options={LIVE_TRANSLATION_OPTIONS.map((option) => {
                const notInstalled =
                  option.modelId !== null &&
                  !installedModelIds.has(option.modelId);
                return {
                  value: option.value,
                  label: option.value,
                  ...(notInstalled ? { group: t("liveNotInstalled") } : {}),
                };
              })}
            />
          </label>
        </section>

        <p className="you-config-live-note">{t("chatConfigLiveNote")}</p>

        <div className="lst-modal-actions you-config-actions">
          <button type="button" className="button quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="button primary btn-shine"
            onClick={() => { save(true); }}
          >
            {t("chatConfigSaveSeparate")}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => { save(false); }}
          >
            {t("chatConfigSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
