import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAudioMeter } from "../audio/useAudioMeter";
import type { EndpointCatalog } from "../audio/model";
import { ColorPicker } from "./ColorPicker";
import { Select } from "./Select";
import { useT } from "../features/i18n/store";
import type { UIKey } from "../features/i18n/strings";
import { type AsrProvider } from "../live/bridge";
import { renderLabel } from "../sources/labels";
import { SOURCE_PRESETS, createSourceFromPreset } from "../sources/presets";
import { detectBlackHole } from "../setup/blackHole";
import { detectVbCable } from "../setup/vbCable";
import {
  MAX_SOURCES,
  type AudioSourceConfig,
  type CaptionAlignment,
  type CaptionLabelStyle,
  type LanguageProfile,
  type LanguageStrictness,
  type SourceConfigs,
} from "../sources/model";
import {
  PROFILE_META,
  PROFILE_OPTIONS,
  STRICTNESS_META,
  STRICTNESS_OPTIONS,
  capabilityNote,
} from "../sources/profiles";
import { loadSourceConfigs, saveSourceConfigs } from "../sources/storage";
import { validateSource } from "../sources/validation";

const SAMPLE_CAPTION = "Rotate B!";

function useSourceConfigs() {
  const [configs, setConfigs] = useState<SourceConfigs>(() =>
    loadSourceConfigs(),
  );

  useEffect(() => {
    saveSourceConfigs(configs);
  }, [configs]);

  const updateSource = (
    sourceId: string,
    patch: Partial<AudioSourceConfig>,
  ) => {
    setConfigs((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.sourceId === sourceId ? { ...source, ...patch } : source,
      ),
    }));
  };

  const addSource = (presetId: string) => {
    setConfigs((current) => {
      if (current.sources.length >= MAX_SOURCES) {
        return current;
      }
      return {
        ...current,
        sources: [
          ...current.sources,
          createSourceFromPreset(presetId as never),
        ],
      };
    });
  };

  const removeSource = (sourceId: string) => {
    setConfigs((current) => {
      if (current.sources.length <= 1) {
        return current;
      }
      return {
        ...current,
        sources: current.sources.filter(
          (source) => source.sourceId !== sourceId,
        ),
      };
    });
  };

  return { configs, updateSource, addSource, removeSource };
}

export const LABEL_STYLE_OPTIONS: readonly {
  value: CaptionLabelStyle;
  labelKey: UIKey;
}[] = [
  { value: "brackets", labelKey: "labelStyleBrackets" },
  { value: "colon", labelKey: "labelStyleColon" },
  { value: "bullet", labelKey: "labelStyleBullet" },
  { value: "stacked", labelKey: "labelStyleStacked" },
  { value: "hidden", labelKey: "labelStyleHidden" },
];

export const CAPTION_ALIGNMENT_OPTIONS: readonly {
  value: CaptionAlignment;
  labelKey: UIKey;
}[] = [
  { value: "left", labelKey: "sourcesAlignLeft" },
  { value: "center", labelKey: "sourcesAlignCenter" },
  { value: "right", labelKey: "sourcesAlignRight" },
];

export const PRESET_OPTIONS = SOURCE_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

/**
 * Capture choices for one source, mirroring the Live page: capture-class
 * endpoints ("microphones") first, then loopback candidates (render
 * endpoints on Windows via WASAPI loopback; BlackHole's input on macOS).
 */
function captureOptions(
  catalog: EndpointCatalog | null,
  isMacos: boolean,
  t: ReturnType<typeof useT>,
): readonly { value: string; label: string; group?: string }[] {
  if (catalog === null) {
    return [];
  }
  const endpoints = catalog.endpoints;
  const microphones: { value: string; label: string; group: string }[] = [];
  const loopback: { value: string; label: string; group: string }[] = [];
  for (const endpoint of endpoints) {
    if (endpoint.state !== "active") {
      continue;
    }
    if (endpoint.kind === "capture") {
      if (isMacos && !/blackhole|black hole/i.test(endpoint.friendlyName)) {
        continue;
      }
      microphones.push({
        value: endpoint.id,
        label: endpoint.friendlyName,
        group: t("sourcesMicrophoneGroup"),
      });
    } else {
      loopback.push({
        value: endpoint.id,
        label: `${endpoint.friendlyName} · loopback`,
        group: t("sourcesLoopbackGroup"),
      });
    }
  }
  return [...microphones, ...loopback];
}

function VbCableCard() {
  const t = useT();
  const audio = useAudioMeter();
  const catalog = audio.catalog;
  if (catalog?.platform !== "windows") {
    return null;
  }
  const detection = detectVbCable(catalog);
  return (
    <section className="card" aria-labelledby="vb-cable-title">
      <div className="card-head">
        <h2 className="card-title" id="vb-cable-title">
          {t("wizardRouteValorant")}
        </h2>
        {detection.installed ? (
          <span className="pill on">
            <span aria-hidden="true" />
            {t("wizardVbCableDetected")}
          </span>
        ) : (
          <span className="pill">{t("sourcesVbCableMissing")}</span>
        )}
      </div>
      <p className="card-note">{t("sourcesVbCableNotice")}</p>
      <div className="routing-guide">
        <div>
          <strong>{t("wizardGameOutput")}</strong>
          <span>{t("wizardPhysicalHeadphones")}</span>
        </div>
        <div>
          <strong>{t("wizardVoiceChatOutput")}</strong>
          <span>VB-CABLE Input</span>
        </div>
      </div>
      {!detection.installed && detection.issues.length > 0 && (
        <ul className="field-warnings" role="status">
          {detection.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AudioSourceFields({
  source,
  catalog,
  onChange,
}: {
  source: AudioSourceConfig;
  catalog: EndpointCatalog | null;
  onChange: (patch: Partial<AudioSourceConfig>) => void;
}) {
  const t = useT();
  const isMacos = catalog?.platform === "macos";
  const captureChoices = useMemo(
    () => captureOptions(catalog, isMacos, t),
    [catalog, isMacos, t],
  );
  const renderChoices = useMemo(
    () =>
      (catalog?.endpoints ?? [])
        .filter(
          (endpoint) =>
            endpoint.kind === "render" && endpoint.state === "active",
        )
        .map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.friendlyName,
        })),
    [catalog],
  );
  const currentEndpointId =
    source.captureTarget.kind === "endpoint"
      ? (source.captureTarget.endpointId ?? "")
      : "";

  const monitoring = source.monitoring;

  return (
    <section
      className="source-audio-fields"
      aria-label={t("sourcesAudioSection")}
    >
      <div className="form-grid">
        <label className="field">
          <span>{t("sourcesAudioSource")}</span>
          <Select
            label={t("sourcesAudioSource")}
            value={currentEndpointId}
            placeholder={t("wizardChooseEndpoint")}
            onChange={(value) => {
              onChange({
                captureTarget: {
                  kind: "endpoint",
                  endpointId: value === "" ? null : value,
                },
              });
            }}
            options={captureChoices}
          />
          <small className="field-note">{t("sourcesAudioSourceNote")}</small>
        </label>
      </div>

      <div className="toggle-row">
        <div>
          <label htmlFor={`monitor-${source.sourceId}`}>
            {t("wizardMonitorSource")}
          </label>
          <p>{t("wizardMonitorSourceNote")}</p>
        </div>
        <input
          id={`monitor-${source.sourceId}`}
          className="switch"
          type="checkbox"
          checked={monitoring.enabled}
          onChange={(event) => {
            onChange({
              monitoring: {
                ...monitoring,
                enabled: event.currentTarget.checked,
                headphoneEndpointId: event.currentTarget.checked
                  ? monitoring.headphoneEndpointId
                  : null,
              },
            });
          }}
        />
      </div>

      {monitoring.enabled && (
        <div className="form-grid">
          <label className="field">
            <span>{t("wizardHeadphoneOutput")}</span>
            <Select
              label={t("wizardHeadphoneOutput")}
              value={monitoring.headphoneEndpointId ?? ""}
              placeholder={t("wizardChooseEndpoint")}
              onChange={(value) => {
                onChange({
                  monitoring: {
                    ...monitoring,
                    headphoneEndpointId: value === "" ? null : value,
                  },
                });
              }}
              options={renderChoices}
            />
          </label>
          <div className="field">
            <div className="range-label">
              <label htmlFor={`blend-${source.sourceId}`}>
                {t("wizardBlend")}
              </label>
              <output htmlFor={`blend-${source.sourceId}`}>
                {String(Math.round(monitoring.volume * 100))}%
              </output>
            </div>
            <input
              id={`blend-${source.sourceId}`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={monitoring.volume}
              onChange={(event) => {
                onChange({
                  monitoring: {
                    ...monitoring,
                    volume: Number(event.currentTarget.value),
                  },
                });
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function SourceCard({
  source,
  siblings,
  onChange,
  onRemove,
  asrProvider,
  catalog,
}: {
  source: AudioSourceConfig;
  siblings: readonly AudioSourceConfig[];
  onChange: (patch: Partial<AudioSourceConfig>) => void;
  onRemove: () => void;
  asrProvider: AsrProvider;
  catalog: EndpointCatalog | null;
}) {
  const t = useT();
  const validation = useMemo(
    () => validateSource(source, siblings),
    [source, siblings],
  );

  return (
    <section className="card" aria-labelledby={`source-${source.sourceId}`}>
      <div className="card-head">
        <h3 className="card-title" id={`source-${source.sourceId}`}>
          {source.displayName.trim() === ""
            ? t("sourcesUnnamed")
            : source.displayName}
        </h3>
        <span className="pill">
          <span aria-hidden="true" />
          {source.sourceId.slice(0, 8)}
        </span>
      </div>

      <AudioSourceFields
        source={source}
        catalog={catalog}
        onChange={onChange}
      />

      <div className="form-grid">
        <label className="field">
          <span>{t("sourcesName")}</span>
          <input
            type="text"
            value={source.displayName}
            maxLength={48}
            onChange={(event) => {
              onChange({ displayName: event.target.value });
            }}
          />
        </label>

        <label className="field">
          <span>{t("sourcesCaptionTag")}</span>
          <input
            type="text"
            value={source.captionTag}
            maxLength={32}
            placeholder="TEAM"
            onChange={(event) => {
              onChange({ captionTag: event.target.value });
            }}
          />
        </label>

        <label className="field">
          <span>{t("sourcesLabelStyle")}</span>
          <Select
            label={t("sourcesLabelStyle")}
            value={source.labelStyle}
            onChange={(value) => {
              onChange({ labelStyle: value as CaptionLabelStyle });
            }}
            options={LABEL_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </label>

        <label className="field">
          <span>{t("sourcesCaptionAlignment")}</span>
          <Select
            label={t("sourcesCaptionAlignment")}
            value={source.captionAlignment}
            onChange={(value) => {
              onChange({ captionAlignment: value as CaptionAlignment });
            }}
            options={CAPTION_ALIGNMENT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </label>

        <label className="field">
          <span>{t("sourcesLanguageProfile")}</span>
          <Select
            label={t("sourcesLanguageProfile")}
            value={source.languageProfile}
            onChange={(value) => {
              onChange({ languageProfile: value as LanguageProfile });
            }}
            options={PROFILE_OPTIONS}
          />
          <small className="field-note">
            {PROFILE_META[source.languageProfile].description}
          </small>
        </label>

        <label className="field">
          <span>{t("sourcesStrictness")}</span>
          <Select
            label={t("sourcesStrictness")}
            value={source.strictness}
            onChange={(value) => {
              onChange({ strictness: value as LanguageStrictness });
            }}
            options={STRICTNESS_OPTIONS}
          />
          <small className="field-note">
            {t(STRICTNESS_META[source.strictness].descriptionKey)}
          </small>
        </label>

        <div className="field field-wide">
          <small className="field-note">
            {capabilityNote(asrProvider, source.languageProfile)}
          </small>
        </div>

        <label className="field">
          <span>{t("sourcesColor")}</span>
          <ColorPicker
            label={t("sourcesColor")}
            value={source.color}
            onChange={(color) => {
              onChange({ color });
            }}
          />
        </label>
      </div>

      <div
        className="preview-stage source-preview"
        aria-label="Caption preview"
      >
        <div className="caption-entry">
          {source.labelStyle === "stacked" &&
            source.captionTag.trim() !== "" && (
              <p
                className="caption-source"
                style={{ color: source.color ?? undefined }}
              >
                {source.captionTag.trim()}
              </p>
            )}
          <p className="caption-english">
            {source.labelStyle !== "stacked" &&
              renderLabel(source.captionTag, source.labelStyle).label !==
                null && (
                <span
                  className="caption-inline-label"
                  style={{ color: source.color ?? undefined }}
                >
                  {renderLabel(source.captionTag, source.labelStyle).label}{" "}
                </span>
              )}
            {SAMPLE_CAPTION}
          </p>
        </div>
      </div>

      {validation.errors.length > 0 && (
        <ul className="field-errors" role="alert">
          {validation.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {validation.warnings.length > 0 && (
        <ul className="field-warnings">
          {validation.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="action-row">
        <button
          className="button quiet danger"
          type="button"
          onClick={onRemove}
          disabled={siblings.length <= 1}
        >
          <Trash2 aria-hidden="true" size={14} />
          {t("sourcesRemove")}
        </button>
      </div>
    </section>
  );
}

function MacosSetupHint() {
  const t = useT();
  const audio = useAudioMeter();
  const catalog = audio.catalog;
  const detection = catalog !== null ? detectBlackHole(catalog) : null;

  if (detection?.installed === true) {
    return (
      <div className="inline-alert ok" role="status">
        <div>
          <strong>{t("sourcesBlackHoleDetected")}</strong>
          <p>
            Route VALORANT voice-chat output to “BlackHole 2ch” in the game's
            audio settings, then capture its input here. Your microphone is
            always available as its own source.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-alert" role="status">
      <div>
        <strong>macOS setup</strong>
        <p>{t("sourcesMacosHint")}</p>
      </div>
    </div>
  );
}

export function SourcesPanel({
  asrProvider = "local",
}: {
  asrProvider?: AsrProvider;
}) {
  const { configs, updateSource, addSource, removeSource } = useSourceConfigs();
  const [presetToAdd, setPresetToAdd] = useState("custom");
  const atMax = configs.sources.length >= MAX_SOURCES;
  const t = useT();
  const audio = useAudioMeter();

  return (
    <div className="page-stack">
      {audio.catalog?.platform === "macos" && <MacosSetupHint />}
      <VbCableCard />
      <section className="card" aria-labelledby="sources-title">
        <div className="card-head">
          <h2 className="card-title" id="sources-title">
            {t("sourcesTitle")}
          </h2>
          <span className="pill on">
            <span aria-hidden="true" />
            {configs.sources.length} of {MAX_SOURCES}
          </span>
        </div>
        <p className="card-note">
          Each source captures one voice channel and labels its captions. Pick
          its audio source and monitoring below; names and tags are free to edit
          — the internal identity never changes.
        </p>
      </section>

      {configs.sources.map((source) => (
        <SourceCard
          key={source.sourceId}
          source={source}
          siblings={configs.sources}
          onRemove={() => {
            removeSource(source.sourceId);
          }}
          asrProvider={asrProvider}
          catalog={audio.catalog}
          onChange={(patch) => {
            updateSource(source.sourceId, patch);
          }}
        />
      ))}

      <div className="action-row">
        <Select
          label={t("sourcesAdd")}
          value={presetToAdd}
          onChange={(value) => {
            setPresetToAdd(value);
          }}
          options={PRESET_OPTIONS}
        />
        <button
          className="button primary"
          type="button"
          disabled={atMax}
          onClick={() => {
            addSource(presetToAdd);
          }}
        >
          <Plus aria-hidden="true" size={15} />
          {t("sourcesAdd")}
        </button>
      </div>
    </div>
  );
}
