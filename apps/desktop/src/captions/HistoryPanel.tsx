import type { CSSProperties } from "react";
import { useState } from "react";
import { ListChecks, Trash2 } from "lucide-react";

import { type HistoryEntry } from "../captions/history";
import { useT } from "../features/i18n/store";

const SHOW_SOURCE_KEY = "lst.history.showSource";

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

export function HistoryPanel({
  entries,
  onClear,
}: {
  entries: HistoryEntry[];
  onClear: () => void;
}) {
  const t = useT();
  const [showSource, setShowSource] = useState<boolean>(
    () => window.localStorage.getItem(SHOW_SOURCE_KEY) === "1",
  );

  const toggleSource = () => {
    setShowSource((current) => {
      const next = !current;
      window.localStorage.setItem(SHOW_SOURCE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <section className="card lst-section-card" aria-labelledby="history-title">
      <div className="card-head">
        <h3 className="card-title" id="history-title">
          {t("historyTitle")}
        </h3>
        <span className="lst-model-count pill">{entries.length}</span>
        <button
          className={`button quiet ${showSource ? "on" : ""}`}
          type="button"
          aria-label={t("historyShowTranscribed")}
          aria-pressed={showSource}
          title={t("historyShowTranscribed")}
          disabled={entries.length === 0}
          onClick={toggleSource}
        >
          <ListChecks aria-hidden="true" size={14} />
          {t("historyShowTranscribed")}
        </button>
        <button
          className="button quiet"
          type="button"
          disabled={entries.length === 0}
          onClick={onClear}
        >
          <Trash2 aria-hidden="true" size={14} />
          {t("historyClear")}
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="lst-model-empty">{t("historyEmpty")}</p>
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
                  <span className="history-who" style={accent.badge}>
                    {entry.displayName !== ""
                      ? entry.displayName
                      : entry.sourceLabel !== ""
                        ? entry.sourceLabel
                        : t("historyUnknownSpeaker")}
                  </span>
                  <time>{formatTime(entry.timestampMs)}</time>
                  {entry.uncertain && (
                    <span className="history-uncertain">?</span>
                  )}
                </div>
                <p className="history-text">{entry.text}</p>
                {showSource && entry.sourceText !== "" && (
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
