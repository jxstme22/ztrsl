import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Select } from "./Select";
import { renderLabel } from "../sources/labels";
import { SOURCE_PRESETS, createSourceFromPreset } from "../sources/presets";
import {
  MAX_SOURCES,
  type AudioSourceConfig,
  type CaptionLabelStyle,
  type SourceConfigs,
} from "../sources/model";
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
  label: string;
}[] = [
  { value: "brackets", label: "Brackets — [TEAM]" },
  { value: "colon", label: "Colon — TEAM:" },
  { value: "bullet", label: "Bullet — • TEAM" },
  { value: "stacked", label: "Stacked — label above" },
  { value: "hidden", label: "Hidden — no label" },
];

export const PRESET_OPTIONS = SOURCE_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
}));

function SourceCard({
  source,
  siblings,
  onChange,
  onRemove,
}: {
  source: AudioSourceConfig;
  siblings: readonly AudioSourceConfig[];
  onChange: (patch: Partial<AudioSourceConfig>) => void;
  onRemove: () => void;
}) {
  const validation = useMemo(
    () => validateSource(source, siblings),
    [source, siblings],
  );

  return (
    <section className="card" aria-labelledby={`source-${source.sourceId}`}>
      <div className="card-head">
        <h3 className="card-title" id={`source-${source.sourceId}`}>
          {source.displayName.trim() === ""
            ? "Unnamed source"
            : source.displayName}
        </h3>
        <span className="pill">
          <span aria-hidden="true" />
          {source.sourceId.slice(0, 8)}
        </span>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Name</span>
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
          <span>Caption tag</span>
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
          <span>Label style</span>
          <Select
            label="Label style"
            value={source.labelStyle}
            onChange={(value) => {
              onChange({ labelStyle: value as CaptionLabelStyle });
            }}
            options={LABEL_STYLE_OPTIONS}
          />
        </label>

        <label className="field">
          <span>Color</span>
          <input
            type="color"
            value={source.color ?? "#7dd3fc"}
            onChange={(event) => {
              onChange({ color: event.target.value });
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
          Remove
        </button>
      </div>
    </section>
  );
}

export function SourcesPanel() {
  const { configs, updateSource, addSource, removeSource } = useSourceConfigs();
  const [presetToAdd, setPresetToAdd] = useState("custom");
  const atMax = configs.sources.length >= MAX_SOURCES;

  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="sources-title">
        <div className="card-head">
          <h2 className="card-title" id="sources-title">
            Audio sources
          </h2>
          <span className="pill on">
            <span aria-hidden="true" />
            {configs.sources.length} of {MAX_SOURCES}
          </span>
        </div>
        <p className="card-note">
          Each source captures one voice channel and labels its captions. Names
          and tags are free to edit — the internal identity never changes.
        </p>
      </section>

      {configs.sources.map((source) => (
        <SourceCard
          key={source.sourceId}
          source={source}
          siblings={configs.sources}
          onChange={(patch) => {
            updateSource(source.sourceId, patch);
          }}
          onRemove={() => {
            removeSource(source.sourceId);
          }}
        />
      ))}

      <div className="action-row">
        <Select
          label="Add source"
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
          Add source
        </button>
      </div>
    </div>
  );
}
