import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  type GlossaryEntry,
  type GlossaryScope,
  type GlossarySet,
  type GlossaryEntryType,
  type PhraseFilterRule,
  type PhraseFilterSet,
  type PhraseMatchMode,
} from "../features/caption-trust/model";
import {
  loadGlossary,
  loadPhraseFilters,
  saveGlossary,
  savePhraseFilters,
} from "../features/caption-trust/storage";
import { Select } from "./Select";

const MATCH_MODES: readonly { value: PhraseMatchMode; label: string }[] = [
  { value: "exact", label: "Exact" },
  { value: "contains", label: "Contains" },
  { value: "similar", label: "Similar" },
  { value: "regex", label: "Regex" },
];

const ENTRY_TYPES: readonly { value: GlossaryEntryType; label: string }[] = [
  { value: "preserve", label: "Preserve" },
  { value: "asr_correction", label: "ASR correction" },
  { value: "preferred_translation", label: "Preferred translation" },
  { value: "alias", label: "Alias" },
];

const SCOPES: readonly { value: GlossaryScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "source", label: "Source" },
  { value: "language_profile", label: "Language profile" },
  { value: "model", label: "Model" },
];

function PhraseFiltersEditor({
  filters,
  onChange,
}: {
  filters: PhraseFilterSet;
  onChange: (next: PhraseFilterSet) => void;
}) {
  const update = (index: number, patch: Partial<PhraseFilterRule>) => {
    const rules = filters.rules.map((rule, i) =>
      i === index ? { ...rule, ...patch } : rule,
    );
    onChange({ schemaVersion: 1, rules });
  };

  return (
    <div className="ct-block">
      <h3>Phrase filters</h3>
      <p className="ct-note">
        Drop known noise before translation (e.g. "user joined your channel").
        Filtered phrases never reach MT or the overlay.
      </p>
      {filters.rules.map((rule, index) => (
        <div className="ct-row" key={`${String(index)}-${rule.text}`}>
          <input
            type="text"
            value={rule.sourceId}
            aria-label="Source id"
            placeholder="source id (32 hex)"
            onChange={(event) => {
              update(index, { sourceId: event.currentTarget.value });
            }}
          />
          <input
            type="text"
            value={rule.text}
            aria-label="Phrase"
            placeholder="phrase or pattern"
            onChange={(event) => {
              update(index, { text: event.currentTarget.value });
            }}
          />
          <Select
            label="Match mode"
            value={rule.matchMode}
            onChange={(value) => {
              update(index, { matchMode: value as PhraseMatchMode });
            }}
            options={MATCH_MODES}
          />
          <input
            className="ct-check"
            type="checkbox"
            aria-label="Enabled"
            checked={rule.enabled}
            onChange={(event) => {
              update(index, { enabled: event.currentTarget.checked });
            }}
          />
          <button
            className="button quiet"
            type="button"
            aria-label="Remove filter"
            onClick={() => {
              onChange({
                schemaVersion: 1,
                rules: filters.rules.filter((_, i) => i !== index),
              });
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
      <button
        className="button"
        type="button"
        onClick={() => {
          onChange({
            schemaVersion: 1,
            rules: [
              ...filters.rules,
              {
                sourceId: "00000000000000000000000000000000",
                text: "",
                matchMode: "contains",
                threshold: 0.87,
                enabled: true,
              },
            ],
          });
        }}
      >
        <Plus aria-hidden="true" size={14} />
        Add filter
      </button>
    </div>
  );
}

function GlossaryEditor({
  glossary,
  onChange,
}: {
  glossary: GlossarySet;
  onChange: (next: GlossarySet) => void;
}) {
  const update = (index: number, patch: Partial<GlossaryEntry>) => {
    const entries = glossary.entries.map((entry, i) =>
      i === index ? { ...entry, ...patch } : entry,
    );
    onChange({ schemaVersion: 1, entries });
  };

  return (
    <div className="ct-block">
      <h3>Glossary & corrections</h3>
      <p className="ct-note">
        Fix misheard ASR, preserve agent names, and force translations. Applied
        before translation; hot-reloads without a model restart.
      </p>
      {glossary.entries.map((entry, index) => (
        <div className="ct-row" key={`${String(index)}-${entry.source}`}>
          <Select
            label="Type"
            value={entry.entryType}
            onChange={(value) => {
              update(index, { entryType: value as GlossaryEntryType });
            }}
            options={ENTRY_TYPES}
          />
          <input
            type="text"
            value={entry.source}
            aria-label="From"
            placeholder='e.g. "bind men"'
            onChange={(event) => {
              update(index, { source: event.currentTarget.value });
            }}
          />
          <input
            type="text"
            value={entry.target}
            aria-label="To"
            placeholder='e.g. "B main"'
            onChange={(event) => {
              update(index, { target: event.currentTarget.value });
            }}
          />
          <Select
            label="Scope"
            value={entry.scope}
            onChange={(value) => {
              update(index, { scope: value as GlossaryScope });
            }}
            options={SCOPES}
          />
          <button
            className="button quiet"
            type="button"
            aria-label="Remove entry"
            onClick={() => {
              onChange({
                schemaVersion: 1,
                entries: glossary.entries.filter((_, i) => i !== index),
              });
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
      <button
        className="button"
        type="button"
        onClick={() => {
          onChange({
            schemaVersion: 1,
            entries: [
              ...glossary.entries,
              {
                entryType: "asr_correction",
                source: "",
                target: "",
                scope: "global",
                scopeKey: null,
                note: "",
              },
            ],
          });
        }}
      >
        <Plus aria-hidden="true" size={14} />
        Add entry
      </button>
    </div>
  );
}

export function CaptionTrustPanel() {
  const [filters, setFilters] = useState<PhraseFilterSet>(loadPhraseFilters);
  const [glossary, setGlossary] = useState<GlossarySet>(loadGlossary);

  useEffect(() => {
    savePhraseFilters(filters);
  }, [filters]);

  useEffect(() => {
    saveGlossary(glossary);
  }, [glossary]);

  return (
    <section
      className="audio-card glass-panel"
      id="caption-trust"
      aria-labelledby="caption-trust-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="caption-trust-title">Caption accuracy tools</h2>
        </div>
        <span className="mode-badge edit">v0.4</span>
      </div>
      <PhraseFiltersEditor filters={filters} onChange={setFilters} />
      <GlossaryEditor glossary={glossary} onChange={setGlossary} />
      <p className="ct-note ct-footnote">
        Saved locally. Hot-reloaded by the live sidecar without a model restart.
      </p>
    </section>
  );
}
