import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Search,
  Settings,
  Trash2,
} from "lucide-react";

import {
  type HistoryDisplayOptions,
  type HistoryEntry,
  type HistorySession,
  loadHistoryDisplayOptions,
  saveHistoryDisplayOptions,
} from "../captions/history";
import { useT } from "../features/i18n/store";
import type { UIKey } from "../features/i18n/strings";

function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Accent styles for a per-source color: badge tint + left edge bar. */
function sourceAccent(color: string): {
  badge: CSSProperties;
  entry: CSSProperties;
} {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { badge: {}, entry: {} };
  }
  return {
    badge: {
      backgroundColor: `${color}26`,
      color,
    },
    entry: {
      borderLeft: `3px solid ${color}`,
    },
  };
}

/** Options menu rows: label + persisted checkbox toggle. */
const OPTION_TOGGLES: readonly {
  key: keyof HistoryDisplayOptions;
  label: UIKey;
}[] = [
  { key: "showSource", label: "historyShowTranscribed" },
  { key: "showSpeaker", label: "historyShowSpeaker" },
  { key: "showTimestamp", label: "historyShowTimestamp" },
  { key: "showLatency", label: "historyShowLatency" },
  { key: "showModels", label: "historyShowModels" },
];

export function HistoryPanel({
  sessions,
  currentSessionId,
  onRenameSession,
  onDeleteSession,
  onClearSession,
}: {
  sessions: HistorySession[];
  currentSessionId: string | null;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
  onClearSession: (id: string) => void;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [options, setOptions] = useState<HistoryDisplayOptions>(
    loadHistoryDisplayOptions,
  );
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState<"sessions" | "settings" | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Default view: the live session, else the most recently started one.
  const selected = useMemo(() => {
    if (sessions.length === 0) {
      return null;
    }
    const live = sessions.find((s) => s.id === currentSessionId);
    if (live !== undefined) {
      return live;
    }
    return (
      sessions.find((s) => s.id === selectedId) ??
      [...sessions].sort((a, b) => b.startedAtMs - a.startedAtMs)[0] ??
      null
    );
  }, [currentSessionId, selectedId, sessions]);

  const entries = useMemo(() => {
    if (selected === null || query.trim() === "") {
      return selected?.entries ?? [];
    }
    const needle = query.trim().toLowerCase();
    return selected.entries.filter(
      (entry) =>
        entry.text.toLowerCase().includes(needle) ||
        entry.sourceText.toLowerCase().includes(needle) ||
        entry.displayName.toLowerCase().includes(needle),
    );
  }, [query, selected]);

  // Close the popovers when clicking anywhere else.
  useEffect(() => {
    if (menuOpen === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); };
  }, [menuOpen]);

  const toggleOption = (key: keyof HistoryDisplayOptions) => {
    setOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      saveHistoryDisplayOptions(next);
      return next;
    });
  };

  const copyEntry = async (entry: HistoryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      window.setTimeout(() => { setCopiedId(null); }, 1200);
    } catch {
      // Clipboard unavailable; nothing else to do.
    }
  };

  const startRename = () => {
    if (selected === null) {
      return;
    }
    setNameDraft(selected.name);
    setRenaming(true);
  };

  const commitRename = () => {
    if (selected !== null && nameDraft.trim() !== "") {
      onRenameSession(selected.id, nameDraft.trim());
    }
    setRenaming(false);
  };

  const deleteSelected = () => {
    if (selected === null) {
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => { setConfirmingDelete(false); }, 3000);
      return;
    }
    setConfirmingDelete(false);
    setSelectedId(null);
    onDeleteSession(selected.id);
  };

  const clearSelected = () => {
    if (selected === null) {
      return;
    }
    onClearSession(selected.id);
    setMenuOpen(null);
  };

  return (
    <section
      className="card lst-section-card history-panel"
      aria-labelledby="history-title"
    >
      <div className="card-head">
        <h3 className="card-title" id="history-title">
          {t("historyTitle")}
        </h3>
        <span className="lst-model-count pill">
          {selected?.entries.length ?? 0}
        </span>
      </div>

      <div className="history-toolbar" ref={toolbarRef}>
        <div className="history-toolbar-group">
          <div className="history-menu-anchor">
            <button
              className="button quiet history-toolbar-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen === "sessions"}
              disabled={sessions.length === 0}
              onClick={() =>
                { setMenuOpen(menuOpen === "sessions" ? null : "sessions"); }
              }
            >
              <CalendarClock aria-hidden="true" size={14} />
              <span className="history-toolbar-label">
                {selected !== null
                  ? selected.name
                  : t("historySessions")}
              </span>
              <ChevronDown aria-hidden="true" size={14} />
            </button>
            {menuOpen === "sessions" && (
              <div className="history-menu" role="menu">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    role="menuitem"
                    className="history-menu-row"
                    onClick={() => {
                      setSelectedId(session.id);
                      setMenuOpen(null);
                    }}
                  >
                    <span className="history-menu-name">
                      {session.name}
                      {session.id === currentSessionId && (
                        <span
                          className="history-live-dot"
                          title={t("historyLiveSession")}
                          aria-label={t("historyLiveSession")}
                        />
                      )}
                    </span>
                    <span className="history-menu-meta">
                      {session.entries.length} ·{" "}
                      {formatTime(session.startedAtMs)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {renaming ? (
            <div className="history-rename">
              <input
                className="history-rename-input"
                value={nameDraft}
                maxLength={64}
                aria-label={t("historyRename")}
                onChange={(event) => { setNameDraft(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    setRenaming(false);
                  }
                }}
                autoFocus
              />
              <button
                className="button quiet"
                type="button"
                aria-label={t("historyRenameSave")}
                disabled={nameDraft.trim() === ""}
                onClick={commitRename}
              >
                <Check aria-hidden="true" size={14} />
              </button>
            </div>
          ) : (
            <button
              className="button quiet history-toolbar-button"
              type="button"
              aria-label={t("historyRename")}
              title={t("historyRename")}
              disabled={selected === null}
              onClick={startRename}
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
          )}

          <button
            className="button quiet history-toolbar-button"
            type="button"
            aria-label={t("historyDelete")}
            title={confirmingDelete ? t("historyDeleteConfirm") : t("historyDelete")}
            disabled={selected === null}
            onClick={deleteSelected}
          >
            <Trash2 aria-hidden="true" size={14} />
            {confirmingDelete && (
              <span className="history-confirm-hint">
                {t("historyDeleteConfirm")}
              </span>
            )}
          </button>
        </div>

        <div className="history-toolbar-group history-toolbar-right">
          <div className="history-search">
            <Search aria-hidden="true" size={13} />
            <input
              value={query}
              placeholder={t("historySearch")}
              aria-label={t("historySearch")}
              onChange={(event) => { setQuery(event.target.value); }}
            />
            {query !== "" && (
              <button
                className="history-search-clear"
                type="button"
                aria-label={t("cancel")}
                onClick={() => { setQuery(""); }}
              >
                ×
              </button>
            )}
          </div>

          <div className="history-menu-anchor">
            <button
              className="button quiet history-toolbar-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen === "settings"}
              aria-label={t("historySettings")}
              title={t("historySettings")}
              onClick={() =>
                { setMenuOpen(menuOpen === "settings" ? null : "settings"); }
              }
            >
              <Settings aria-hidden="true" size={14} />
            </button>
            {menuOpen === "settings" && (
              <div className="history-menu" role="menu">
                {OPTION_TOGGLES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={options[key]}
                    className="history-menu-row"
                    onClick={() => { toggleOption(key); }}
                  >
                    <span
                      className={`history-check ${options[key] ? "on" : ""}`}
                      aria-hidden="true"
                    >
                      {options[key] && <Check size={11} />}
                    </span>
                    {t(label)}
                  </button>
                ))}
                <div className="history-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="history-menu-row history-menu-danger"
                  disabled={selected === null || selected.entries.length === 0}
                  onClick={clearSelected}
                >
                  <Trash2 aria-hidden="true" size={13} />
                  {t("historyClearSession")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {selected === null ? (
        <p className="lst-model-empty">{t("historyEmpty")}</p>
      ) : entries.length === 0 ? (
        <p className="lst-model-empty">
          {query.trim() === ""
            ? t("historySessionEmpty")
            : t("historySearchEmpty")}
        </p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => {
            const accent = sourceAccent(entry.color);
            return (
              <li
                key={entry.id}
                className="history-entry"
                data-uncertain={entry.uncertain || undefined}
                style={accent.entry}
              >
                <div className="history-entry-meta">
                  {options.showSpeaker && (
                    <span className="history-who" style={accent.badge}>
                      {entry.displayName !== ""
                        ? entry.displayName
                        : entry.sourceLabel !== ""
                          ? entry.sourceLabel
                          : t("historyUnknownSpeaker")}
                    </span>
                  )}
                  {options.showTimestamp && (
                    <time>{formatTime(entry.timestampMs)}</time>
                  )}
                  {options.showLatency && entry.latencyMs > 0 && (
                    <span className="history-latency">
                      {entry.latencyMs} ms
                    </span>
                  )}
                  {options.showModels && entry.provider !== "" && (
                    <span className="history-models">{entry.provider}</span>
                  )}
                  {entry.uncertain && (
                    <span className="history-uncertain">?</span>
                  )}
                  <button
                    className="history-copy"
                    type="button"
                    aria-label={t("historyCopy")}
                    title={t("historyCopy")}
                    onClick={() => void copyEntry(entry)}
                  >
                    {copiedId === entry.id ? (
                      <Check aria-hidden="true" size={13} />
                    ) : (
                      <Copy aria-hidden="true" size={13} />
                    )}
                  </button>
                </div>
                <p className="history-text">{entry.text}</p>
                {options.showSource && entry.sourceText !== "" && (
                  <p className="history-source">{entry.sourceText}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
