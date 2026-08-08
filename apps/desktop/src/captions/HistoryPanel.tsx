import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Mic,
  Pencil,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
  User,
} from "lucide-react";

import {
  type HistoryDisplayOptions,
  type HistoryEntry,
  type HistorySession,
  loadHistoryDisplayOptions,
  saveHistoryDisplayOptions,
  YOU_ACCENT_COLOR,
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
  key: Exclude<keyof HistoryDisplayOptions, "bubbleColor" | "layout">;
  label: UIKey;
}[] = [
  { key: "showSource", label: "historyShowTranscribed" },
  { key: "showSpeaker", label: "historyShowSpeaker" },
  { key: "showTimestamp", label: "historyShowTimestamp" },
  { key: "showLatency", label: "historyShowLatency" },
  { key: "showModels", label: "historyShowModels" },
  { key: "showAvatars", label: "historyShowAvatars" },
];

export function HistoryPanel({
  sessions,
  currentSessionId,
  onRenameSession,
  onDeleteSession,
  onClearSession,
  onCountChange,
  micEnabled,
  micConfigured,
  liveRunning,
  onToggleMic,
  onSendChat,
  onOpenYouConfig,
  separatedState,
  separatedError,
  onStartSeparatedLive,
  onStopSeparatedLive,
}: {
  sessions: HistorySession[];
  currentSessionId: string | null;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
  onClearSession: (id: string) => void;
  onCountChange?: (count: number) => void;
  /** Whether the "you" mic stream is currently capturing on the live session. */
  micEnabled: boolean;
  /** Whether a mic endpoint is configured for the "you" stream. */
  micConfigured: boolean;
  /** Whether a live translation session is running (required for the mic). */
  liveRunning: boolean;
  onToggleMic: () => Promise<boolean>;
  /** Translate + record a typed chat message. Returns the recorded entry id,
   * or null when nothing was recorded (translation failed / no session). */
  onSendChat: (text: string) => Promise<string | null>;
  onOpenYouConfig: () => void;
  /** Separated live session status (started from this page). */
  separatedState: "idle" | "starting" | "listening" | "stopping" | "error";
  separatedError: string | null;
  onStartSeparatedLive: () => Promise<string | null>;
  onStopSeparatedLive: () => Promise<void>;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [options, setOptions] = useState<HistoryDisplayOptions>(
    loadHistoryDisplayOptions,
  );
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState<"settings" | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [separatedBusy, setSeparatedBusy] = useState(false);
  const [separatedLocalError, setSeparatedLocalError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

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

  // Chat-room grouping: consecutive bubbles from the same speaker merge
  // into one bubble (each message becomes its own line) until another
  // speaker talks. "Same speaker" = same fromSelf flag + same display
  // identity (source id when present, else the display name).
  const messageGroups = useMemo(() => {
    const groups: HistoryEntry[][] = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      const previous = last?.[last.length - 1];
      const sameSpeaker =
        previous?.fromSelf === entry.fromSelf &&
        (previous.sourceId !== ""
          ? previous.sourceId === entry.sourceId
          : previous.displayName === entry.displayName &&
            previous.sourceLabel === entry.sourceLabel);
      if (sameSpeaker && last !== undefined) {
        last.push(entry);
      } else {
        groups.push([entry]);
      }    }
    return groups;
  }, [entries]);

  useEffect(() => {
    onCountChange?.(selected?.entries.length ?? 0);
  }, [onCountChange, selected]);

  // Chat-room auto-bottom: stick to the newest message unless the user has
  // scrolled up to read older ones. Newest entries arrive at the bottom.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    if (stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [entries.length, selected?.id]);

  useEffect(() => {
    stickToBottomRef.current = true;
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [selected?.id]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (scroller === null) {
      return;
    }
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 64;
  };

  // Close the popovers when clicking anywhere else.
  useEffect(() => {
    if (menuOpen === null && !sessionsOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setMenuOpen(null);
        setSessionsOpen(false);
        setLayoutOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); };
  }, [menuOpen, sessionsOpen]);

  // Session sidebar is mutually exclusive with the settings menu.
  useEffect(() => {
    if (sessionsOpen) {
      setMenuOpen(null);
      setLayoutOpen(false);
    }
  }, [sessionsOpen]);

  const toggleOption = (key: keyof HistoryDisplayOptions) => {
    setOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      saveHistoryDisplayOptions(next);
      return next;
    });
  };

  // Copy one translation (a single message inside a bubble).
  const copyEntry = async (entry: HistoryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      window.setTimeout(() => { setCopiedId(null); }, 1200);
    } catch {
      // Clipboard unavailable; nothing else to do.
    }
  };

  // Copy a merged bubble group: mark the first entry in the group.
  const copyMerged = async (text: string, group: HistoryEntry[]) => {
    try {
      await navigator.clipboard.writeText(text);
      const first = group[0];
      if (first !== undefined) {
        setCopiedId(first.id);
      }
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

  const toggleMic = async () => {
    if (micBusy) {
      return;
    }
    setMicBusy(true);
    setMicError(null);
    try {
      await onToggleMic();
    } catch (cause) {
      setMicError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMicBusy(false);
    }
  };

  const onMicClick = () => {
    void toggleMic();
  };

  const submitChat = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || sending) {
      return;
    }
    setSending(true);
    try {
      const recordedId = await onSendChat(text);
      if (recordedId !== null) {
        setDraft("");
        // Newest message is a chat bubble; snap to it.
        requestAnimationFrame(() => {
          const scroller = scrollRef.current;
          if (scroller !== null) {
            scroller.scrollTop = scroller.scrollHeight;
          }
        });
      }
    } finally {
      setSending(false);
    }
  };

  const micDisabled = !liveRunning || !micConfigured;
  const micHint = !liveRunning
    ? t("chatMicRequiresLive")
    : !micConfigured
      ? t("chatMicNeedsConfig")
      : undefined;

  return (
    <section
      className="card lst-section-card history-panel history-chat"
      aria-label={t("historyTitle")}
    >
      <div className="history-toolbar" ref={toolbarRef}>
        <div className="history-toolbar-group">
          <button
            className={`button quiet history-toolbar-button ${sessionsOpen ? "on" : ""}`}
            type="button"
            aria-expanded={sessionsOpen}
            aria-label={t("historySessions")}
            disabled={sessions.length === 0}
            onClick={() => { setSessionsOpen((current) => !current); }}
          >
            <CalendarClock aria-hidden="true" size={14} />
            <span className="history-toolbar-label">
              {selected !== null
                ? selected.name
                : t("historySessions")}
            </span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>

          <div
            className={`history-separated ${separatedState === "listening" ? "on" : ""}`}
            role="status"
          >
            <span className="history-separated-label">
              {t("historySeparatedLive")}
            </span>
            {separatedState === "listening" ? (
              <button
                type="button"
                className="button quiet history-separated-stop"
                disabled={separatedBusy}
                onClick={() => {
                  setSeparatedBusy(true);
                  void onStopSeparatedLive().finally(() => {
                    setSeparatedBusy(false);
                  });
                }}
              >
                {t("historySeparatedStop")}
              </button>
            ) : (
              <button
                type="button"
                className="button quiet history-separated-start"
                disabled={separatedBusy || separatedState === "starting"}
                onClick={() => {
                  setSeparatedBusy(true);
                  setSeparatedLocalError(null);
                  void onStartSeparatedLive()
                    .then((error) => {
                      if (error !== null) {
                        setSeparatedLocalError(error);
                      }
                    })
                    .finally(() => {
                      setSeparatedBusy(false);
                    });
                }}
              >
                {separatedState === "starting"
                  ? t("historySeparatedStarting")
                  : t("historySeparatedStart")}
              </button>
            )}
          </div>
          {(separatedLocalError ?? separatedError) !== null && (
            <span className="history-separated-error" role="alert">
              {separatedLocalError ?? separatedError}
            </span>
          )}

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

          <div className="history-menu-anchor history-menu-anchor-right">
            <button
              className="button quiet history-toolbar-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen === "settings"}
              aria-label={t("historySettings")}
              title={t("historySettings")}
              onClick={() =>
                { setMenuOpen(menuOpen === "settings" ? null : "settings"); setLayoutOpen(false); }
              }
            >
              <Settings aria-hidden="true" size={14} />
            </button>
            {menuOpen === "settings" && (
              <div className="history-menu history-menu-noclip" role="menu">
                {OPTION_TOGGLES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={options[key]}
                    className="history-menu-row"
                    onClick={() => { toggleOption(key); }}
                  >
                    <span className="history-menu-label">{t(label)}</span>
                    <span
                      className={`history-check ${options[key] ? "on" : ""}`}
                      aria-hidden="true"
                    >
                      {options[key] && <Check size={12} />}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={options.bubbleColor === "source"}
                  className="history-menu-row"
                  onClick={() => {
                    setOptions((current) => {
                      const next: HistoryDisplayOptions = {
                        ...current,
                        bubbleColor:
                          current.bubbleColor === "source" ? "default" : "source",
                      };
                      saveHistoryDisplayOptions(next);
                      return next;
                    });
                  }}
                >
                  <span className="history-menu-label">
                    {t("historyBubbleColor")}
                  </span>
                  <span
                    className={`history-check ${options.bubbleColor === "source" ? "on" : ""}`}
                    aria-hidden="true"
                  >
                    {options.bubbleColor === "source" && <Check size={12} />}
                  </span>
                </button>

                <div className="history-menu-anchor">
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={layoutOpen}
                    className="history-menu-row"
                    onClick={() => { setLayoutOpen((current) => !current); }}
                  >
                    <span className="history-menu-label">
                      {t("historyLayout")}
                    </span>
                    <span className="history-menu-value">
                      {options.layout === "classic"
                        ? t("historyLayoutClassic")
                        : t("historyLayoutChat")}
                      <ChevronDown
                        aria-hidden="true"
                        size={12}
                        className="history-menu-chevron"
                      />
                    </span>
                  </button>
                  {layoutOpen && (
                    <div
                      className="history-menu history-submenu"
                      role="menu"
                      aria-label={t("historyLayout")}
                    >
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={options.layout === "classic"}
                        className="history-menu-row"
                        onClick={() => {
                          setOptions((current) => {
                            const next: HistoryDisplayOptions = {
                              ...current,
                              layout: "classic",
                            };
                            saveHistoryDisplayOptions(next);
                            return next;
                          });
                          setLayoutOpen(false);
                        }}
                      >
                        <span className="history-menu-label">
                          {t("historyLayoutClassic")}
                        </span>
                        <span
                          className={`history-check ${options.layout === "classic" ? "on" : ""}`}
                          aria-hidden="true"
                        >
                          {options.layout === "classic" && <Check size={12} />}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={options.layout === "chat"}
                        className="history-menu-row"
                        onClick={() => {
                          setOptions((current) => {
                            const next: HistoryDisplayOptions = {
                              ...current,
                              layout: "chat",
                            };
                            saveHistoryDisplayOptions(next);
                            return next;
                          });
                          setLayoutOpen(false);
                        }}
                      >
                        <span className="history-menu-label">
                          {t("historyLayoutChat")}
                        </span>
                        <span
                          className={`history-check ${options.layout === "chat" ? "on" : ""}`}
                          aria-hidden="true"
                        >
                          {options.layout === "chat" && <Check size={12} />}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="history-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="history-menu-row history-menu-danger"
                  disabled={selected === null || selected.entries.length === 0}
                  onClick={clearSelected}
                >
                  <span className="history-menu-label">
                    {t("historyClearSession")}
                  </span>
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="history-body">
        {sessionsOpen && (
          <aside className="history-sessions" aria-label={t("historySessions")}>
            <div className="history-sessions-head">
              <span>{t("historySessions")}</span>
              <span className="history-sessions-count">{sessions.length}</span>
            </div>
            <ol className="history-sessions-list">
              {[...sessions]
                .sort((a, b) => b.startedAtMs - a.startedAtMs)
                .map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`history-session-row ${
                        selected?.id === session.id ? "on" : ""
                      }`}
                      onClick={() => {
                        setSelectedId(session.id);
                        setSessionsOpen(false);
                      }}
                    >
                      <span className="history-session-name">
                        {session.name}
                        {session.id === currentSessionId && (
                          <span
                            className="history-live-dot"
                            title={t("historyLiveSession")}
                            aria-label={t("historyLiveSession")}
                          />
                        )}
                      </span>
                      <span className="history-session-meta">
                        {session.entries.length} · {formatTime(session.startedAtMs)}
                      </span>
                    </button>
                  </li>
                ))}
            </ol>
          </aside>
        )}

        <div className="history-main">
          <div
            className="history-scroll"
            ref={scrollRef}
            onScroll={onScroll}
            role="log"
            aria-live="polite"
          >
        {selected === null ? (
          <p className="lst-model-empty">{t("historyEmpty")}</p>
        ) : entries.length === 0 ? (
          <p className="lst-model-empty">
            {query.trim() === ""
              ? t("historySessionEmpty")
              : t("historySearchEmpty")}
          </p>
        ) : options.layout === "classic" ? (
          <ol className="history-list history-list-classic">
            {entries.map((entry) => {
              const accent = sourceAccent(entry.color);
              const fromSelf = entry.fromSelf;
              const who =
                entry.displayName !== ""
                  ? entry.displayName
                  : entry.sourceLabel !== ""
                    ? entry.sourceLabel
                    : t("historyUnknownSpeaker");
              return (
                <li
                  key={entry.id}
                  className={`history-entry-classic ${
                    fromSelf ? "self" : ""
                  }`}
                  data-uncertain={entry.uncertain || undefined}
                  style={accent.entry}
                >
                  <div className="history-entry-meta">
                    {options.showSpeaker && (
                      <span className="history-who" style={accent.badge}>
                        {fromSelf ? t("historyYou") : who}
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
                      onClick={() => { void copyEntry(entry); }}
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
        ) : (
          <ol className="history-list">
            {messageGroups.map((group) => {
              const first = group[0];
              if (first === undefined) {
                return null;
              }
              const last = group[group.length - 1];
              return (
                <ChatBubble
                  key={first.id}
                  group={group}
                  options={options}
                  copiedId={copiedId}
                  onCopyOne={(item) => { void copyEntry(item); }}
                  onCopyAll={() => {
                    const merged = group
                      .map((entry) => entry.text)
                      .filter((text) => text !== "")
                      .join("\n");
                    void copyMerged(merged, group);
                  }}
                  formatTime={formatTime}
                  firstTimestamp={first.timestampMs}
                  lastTimestamp={last?.timestampMs ?? first.timestampMs}
                />
              );
            })}
          </ol>
        )}
      </div>

      <form
        className="history-input-card"
        onSubmit={(event) => { void submitChat(event); }}
      >
        <input
          className="history-chat-input"
          value={draft}
          placeholder={t("chatPlaceholder")}
          aria-label={t("chatPlaceholder")}
          maxLength={2000}
          onChange={(event) => { setDraft(event.target.value); }}
        />
        <button
          type="button"
          className="button quiet history-toolbar-button history-input-settings"
          aria-label={t("chatConfig")}
          title={t("chatConfig")}
          onClick={onOpenYouConfig}
        >
          <SlidersHorizontal aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          className={`history-mic-button ${micEnabled ? "on" : ""}`}
          aria-label={micEnabled ? t("chatMicLive") : t("chatMic")}
          title={micHint ?? (micEnabled ? t("chatMicLive") : t("chatMic"))}
          aria-disabled={micDisabled || micBusy}
          disabled={micDisabled || micBusy}
          onClick={onMicClick}
        >
          <Mic aria-hidden="true" size={14} />
        </button>
        <button
          type="submit"
          className="button primary btn-shine history-send-button"
          disabled={draft.trim() === "" || sending}
          aria-label={t("chatSend")}
        >
          {sending ? (
            <span className="history-send-spinner" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" size={14} />
          )}
        </button>
        {micError !== null && (
          <div className="history-mic-error" role="alert">
            <span>{micError}</span>
          </div>
        )}
      </form>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({
  group,
  options,
  copiedId,
  onCopyOne,
  onCopyAll,
  formatTime,
  firstTimestamp,
  lastTimestamp,
}: {
  /** One or more consecutive messages from the same speaker. */
  group: HistoryEntry[];
  options: HistoryDisplayOptions;
  /** Which entry currently shows the "copied" check, or null. */
  copiedId: string | null;
  /** Copy one message inside a merged bubble. */
  onCopyOne: (entry: HistoryEntry) => void;
  /** Copy the whole merged bubble's text. */
  onCopyAll: () => void;
  formatTime: (timestampMs: number) => string;
  firstTimestamp: number;
  lastTimestamp: number;
}) {
  const t = useT();
  const entry = group[0];
  const fromSelf = entry?.fromSelf ?? false;
  const accent = sourceAccent(entry?.color ?? "");
  const bubbleTint =
    options.bubbleColor === "source" && entry?.color !== ""
      ? (entry?.color ?? "")
      : fromSelf
        ? YOU_ACCENT_COLOR
        : "";
  const who =
    (entry?.displayName ?? "") !== ""
      ? (entry?.displayName ?? "")
      : (entry?.sourceLabel ?? "") !== ""
        ? (entry?.sourceLabel ?? "")
        : t("historyUnknownSpeaker");
  const initial = (who.charAt(0) || "?").toUpperCase();
  const anyUncertain = group.some((item) => item.uncertain);
  return (
    <li
      className={`history-entry chat-bubble ${fromSelf ? "self" : "other"}`}
      data-uncertain={anyUncertain || undefined}
      style={accent.entry}
    >
      {options.showAvatars && (
        <span
          className={`chat-avatar ${fromSelf ? "self" : ""}`}
          style={
            options.bubbleColor === "source" && entry?.color !== ""
              ? { backgroundColor: `${entry?.color ?? ""}26`, color: entry?.color }
              : undefined
          }
          aria-hidden="true"
        >
          {fromSelf ? <User size={13} /> : initial}
        </span>
      )}
      <div className="chat-bubble-body">
        <div className="history-entry-meta">
          {options.showSpeaker && (
            <span className="history-who" style={accent.badge}>
              {fromSelf ? t("historyYou") : who}
            </span>
          )}
          {options.showTimestamp && (
            <time>
              {formatTime(firstTimestamp)}
              {lastTimestamp !== firstTimestamp
                ? ` – ${formatTime(lastTimestamp)}`
                : ""}
            </time>
          )}
          {options.showLatency &&
            group.some((item) => item.latencyMs > 0) && (
              <span className="history-latency">
                {group.find((item) => item.latencyMs > 0)?.latencyMs} ms
              </span>
            )}
          {options.showModels &&
            group.some((item) => item.provider !== "") && (
              <span className="history-models">
                {group.find((item) => item.provider !== "")?.provider}
              </span>
            )}
          {anyUncertain && (
            <span className="history-uncertain">?</span>
          )}
        </div>
        <div className="chat-bubble-row">
          <div
            className="chat-bubble-tip"
            style={
              bubbleTint !== ""
                ? {
                    backgroundColor:
                      options.bubbleColor === "source" && entry?.color !== ""
                        ? `${entry?.color ?? ""}14`
                        : `${YOU_ACCENT_COLOR}14`,
                  }
                : undefined
            }
          >
            {group.map((item) => (
              <div className="chat-bubble-message" key={item.id}>
                <p className="history-text">{item.text}</p>
                {options.showSource && item.sourceText !== "" && (
                  <p className="history-source">{item.sourceText}</p>
                )}
                <button
                  className="history-copy"
                  type="button"
                  aria-label={t("historyCopy")}
                  title={t("historyCopy")}
                  onClick={() => { onCopyOne(item); }}
                >
                  {copiedId === item.id ? (
                    <Check aria-hidden="true" size={13} />
                  ) : (
                    <Copy aria-hidden="true" size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
          {group.length > 1 && (
            <button
              className="history-copy history-copy-all"
              type="button"
              aria-label={t("historyCopyAll")}
              title={t("historyCopyAll")}
              onClick={onCopyAll}
            >
              {copiedId !== null && group.some((e) => e.id === copiedId) ? (
                <Check aria-hidden="true" size={13} />
              ) : (
                <Copy aria-hidden="true" size={13} />
              )}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
