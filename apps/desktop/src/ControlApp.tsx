import {
  Activity,
  Boxes,
  Gauge,
  GripHorizontal,
  Info,
  MessageSquareText,
  Mic,
  Minus,
  PictureInPicture2,
  Pin,
  Rocket,
  ScrollText,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";

import { HistoryPanel } from "./captions/HistoryPanel";
import { useCaptionHistory } from "./captions/useCaptionHistory";
import { translateText } from "./chat/bridge";
import { YouConfigDialog } from "./components/YouConfigDialog";
import { AudioDevicePanel } from "./components/AudioDevicePanel";
import { AccuracyLabPanel } from "./components/AccuracyLabPanel";
import { CaptionStack } from "./components/CaptionStack";
import { CaptionTrustPanel } from "./components/CaptionTrustPanel";
import { ClipLabPanel } from "./components/ClipLabPanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { HotkeyPanel } from "./components/HotkeyPanel";
import { IpcPanel } from "./components/IpcPanel";
import { LiveTranslationPanel } from "./components/LiveTranslationPanel";
import { ProfilePage } from "./setup/ProfilePage";
import { AboutPanel } from "./components/AboutPanel";
import { ModelsPanel } from "./components/ModelsPanel";
import { OverlaySettingsPanel } from "./components/OverlaySettingsPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { Select } from "./components/Select";
import { SourcesPanel } from "./components/SourcesPanel";
import { WelcomeModelsDialog } from "./components/WelcomeModelsDialog";
import { useAudioMeter } from "./audio/useAudioMeter";
import { useDiagnostics } from "./diagnostics/useDiagnostics";
import { useUiLanguage } from "./features/i18n/useUiLanguage";
import { useT } from "./features/i18n/store";
import { setAppTheme, useAppThemeValue } from "./features/theme/store";
import { useLiveTranslation } from "./live/useLiveTranslation";
import { useSeparatedLiveTranslation } from "./live/useSeparatedLiveTranslation";
import type {
  AsrProvider,
  LiveSourceRequest,
  SourceMode as LiveSourceMode,
  TargetLanguage,
  TranslationProvider,
} from "./live/bridge";
import { useGpuRuntime } from "./models/useGpuRuntime";
import { useModels } from "./models/useModels";
import { isDesktopRuntime, emitHistoryToOverlay, beginOverlayDrag } from "./overlay/bridge";
import type { Caption, OverlaySettings } from "./overlay/model";
import {
  buildYouSourceRequest,
  loadYouConfig,
  resolveYouDirection,
  type YouStreamConfig,
} from "./you/config";
import { useOverlayController } from "./overlay/useOverlayController";
import { loadSourceConfigs } from "./sources/storage";
import { captionTrustEnabled } from "./sources/captionTrustFlag";
import { multiSourceEnabled } from "./sources/featureFlag";

type SectionId =
  | "live"
  | "profile"
  | "models"
  | "history"
  | "settings"
  | "diagnostics"
  | "sources"
  | "about";

const APP_VERSION = "0.9.1";

type Controller = ReturnType<typeof useOverlayController>;
type AudioController = ReturnType<typeof useAudioMeter>;
type LiveController = ReturnType<typeof useLiveTranslation>;
type ModelsController = ReturnType<typeof useModels>;
type GpuRuntimeController = ReturnType<typeof useGpuRuntime>;
type DiagnosticsController = ReturnType<typeof useDiagnostics>;
type LanguageController = ReturnType<typeof useUiLanguage>;

function navItems(
  t: LanguageController["t"],
): readonly { id: SectionId; label: string }[] {
  return [
    { id: "live", label: t("navLive") },
    { id: "history", label: t("navHistory") },
    { id: "profile", label: t("navSetup") },
    ...(multiSourceEnabled()
      ? [{ id: "sources" as SectionId, label: t("navSources") }]
      : []),
    { id: "models", label: t("navModels") },
    { id: "settings", label: t("navSettings") },
    { id: "diagnostics", label: t("navDiagnostics") },
  ];
}

const NAV_ICONS: Record<SectionId, LucideIcon> = {
  live: Activity,
  history: MessageSquareText,
  profile: Rocket,
  sources: Mic,
  models: Boxes,
  settings: Settings,
  diagnostics: Gauge,
  about: Info,
};

export function ControlApp() {
  const controller = useOverlayController();
  const audio = useAudioMeter();
  const history = useCaptionHistory();
  const historyRef = useRef(history);
  historyRef.current = history;
  const liveRef = useRef<ReturnType<typeof useLiveTranslation> | null>(null);
  // Every caption flows through here: history records finals (and ignores
  // provisional listening updates), the overlay controller renders the live
  // caption lane. Session context is stamped at finalization: who's talking
  // (source display name) and which audio input the session captures.
  const ingestCaption = useCallback(
    (caption: Caption) => {
      const endpoint = audio.catalog?.endpoints.find(
        (candidate) => candidate.id === liveRef.current?.sessionEndpointId,
      );
      let displayName = "";
      if (caption.source !== undefined) {
        displayName =
          loadSourceConfigs().sources.find(
            (config) => config.sourceId === caption.source?.sourceId,
          )?.displayName ?? caption.source.captionTag;
      }
      const snapshot = liveRef.current?.snapshot;
      const modelLabel =
        snapshot?.asrModel !== null && snapshot?.provider !== null
          ? `${snapshot?.asrModel ?? ""} + ${snapshot?.provider ?? ""}`
          : "";
      historyRef.current.record(caption, {
        displayName,
        audioSource: endpoint?.friendlyName ?? "",
        provider: modelLabel,
      });
      controller.ingestCaption(caption);
    },
    [audio.catalog, controller],
  );
  const live = useLiveTranslation(ingestCaption);
  liveRef.current = live;
  // The user's own voice & chat stream config (mic endpoint, direction,
  // models). Defaults auto-reverse of the live pair when a live session
  // runs; the config dialog lets the user override.
  const [youConfig, setYouConfig] = useState<YouStreamConfig>(loadYouConfig);
  const [youConfigOpen, setYouConfigOpen] = useState(false);
  // The live pair drives the "you" direction default (auto-reverse).
  const livePair = useMemo(
    () => ({
      sourceMode: live.snapshot.sourceMode,
      targetLanguage: live.snapshot.targetLanguage,
    }),
    [live.snapshot.sourceMode, live.snapshot.targetLanguage],
  );
  const youSource = useMemo(
    () =>
      buildYouSourceRequest(
        youConfig,
        livePair,
        window.localStorage.getItem("lst.live.translation-provider") ?? "nllb",
      ),
    [livePair, youConfig],
  );
  const models = useModels();
  const gpuRuntime = useGpuRuntime();
  const diagnostics = useDiagnostics();
  const language = useUiLanguage();
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<SectionId>("live");
  // Total translation count of the session currently shown in HistoryPanel,
  // lifted up so it can be displayed in the titlebar window-actions.
  const [historyCount, setHistoryCount] = useState(0);
  // Show the welcome card only on a fresh install — when no models are
  // installed yet. Once the user has models, the welcome never reappears.
  const [showWelcome, setShowWelcome] = useState(
    () => !models.hasInstalledModels,
  );

  // The separated live session (started from the history page): a second,
  // independent live translation that shares the sidecar process (models)
  // with the main live session. Its captions go to history only.
  const separatedLiveRef = useRef<
    ReturnType<typeof useSeparatedLiveTranslation> | null
  >(null);
  const separatedLive = useSeparatedLiveTranslation((caption) => {
    const endpoint = audio.catalog?.endpoints.find(
      (candidate) => candidate.id === separatedLiveRef.current?.sessionEndpointId,
    );
    let displayName = "";
    if (caption.source !== undefined) {
      displayName =
        loadSourceConfigs().sources.find(
          (config) => config.sourceId === caption.source?.sourceId,
        )?.displayName ?? caption.source.captionTag;
    }
    const snapshot = separatedLiveRef.current?.snapshot;
    const modelLabel =
      snapshot?.asrModel !== null && snapshot?.provider !== null
        ? `${snapshot?.asrModel ?? ""} + ${snapshot?.provider ?? ""}`
        : "";
    historyRef.current.record(caption, {
      displayName,
      audioSource: endpoint?.friendlyName ?? "",
      provider: modelLabel,
    });
  });
  separatedLiveRef.current = separatedLive;

  // Keep the overlay window's history view in sync (it also boots from the
  // same localStorage, so this only needs to run when entries change).
  useEffect(() => {
    if (desktop) {
      void emitHistoryToOverlay(history.activeEntries);
    }
  }, [desktop, history.activeEntries]);

  // History sessions: when live translation reaches the listening state, the
  // live pipeline carries a session id (fresh, or a kept-open one reused via
  // sessionIdHint). Create the session record once; a kept-open id already
  // exists and is simply pointed at by the reducer.
  useEffect(() => {
    if (live.state !== "listening" || live.sessionId === null) {
      return;
    }
    if (historyRef.current.sessions.some((s) => s.id === live.sessionId)) {
      return;
    }
    const locale = language.language === "zh" ? "zh-CN" : "en-US";
    const date = new Date().toLocaleString(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    historyRef.current.beginSession(
      live.sessionId,
      `${language.t("historySessionPrefix")} · ${date}`,
    );
  }, [language, live.sessionId, live.state]);

  // Stop-live confirmation: the user picks whether the current session ends
  // (transcript stays in History) or stays open for the next start.
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const requestStop = useCallback(() => {
    setStopDialogOpen(true);
  }, []);

  const resolveStop = useCallback(
    (endSession: boolean) => {
      setStopDialogOpen(false);
      if (endSession && live.sessionId !== null) {
        historyRef.current.endSession(live.sessionId);
      }
      void live.stop();
    },
    [live],
  );

  // The "you" mic toggle: flips the shared flag the Rust live loop watches.
  // Requires a running live session with a configured mic stream.
  const toggleMic = useCallback(async (): Promise<boolean> => {
    const next = !live.snapshot.micEnabled;
    const applied = await live.setMicEnabled(next);
    return applied === next;
  }, [live]);

  // Typed-chat translation: translate on demand (standalone sidecar), then
  // record the "you" bubble. When no session is open (e.g. chat before any
  // live run), open a "Chat" session first so the bubble is saved.
  const sendChat = useCallback(
    async (text: string): Promise<string | null> => {
      const direction = resolveYouDirection(youConfig, livePair);
      const liveTranslationProvider =
        window.localStorage.getItem("lst.live.translation-provider") ?? "nllb";
      let result;
      try {
        result = await translateText(
          text,
          direction.sourceMode,
          direction.targetLanguage,
          liveTranslationProvider as TranslationProvider,
        );
      } catch (cause) {
        console.error("chat translation failed:", cause);
        return null;
      }
      if (historyRef.current.currentSessionId === null) {
        const id = `sess-${String(Date.now())}`;
        const locale = language.language === "zh" ? "zh-CN" : "en-US";
        const date = new Date().toLocaleString(locale, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        historyRef.current.beginSession(
          id,
          `${language.t("chatStandaloneSession")} · ${date}`,
        );
      }
      const entryId = `chat-${String(Date.now())}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const recorded = historyRef.current.recordChat({
        id: entryId,
        text: result.translatedText,
        sourceText: text,
        provider: result.provider,
      });
      if (recorded === null) {
        return null;
      }
      void emitHistoryToOverlay(historyRef.current.activeEntries);
      return recorded;
    },
    [language, livePair, youConfig],
  );

  // Start the separated live session from the history page. It uses the
  // modal's "Live translation" section (the same lst.live.* keys the Live
  // page reads) and shares the sidecar process — so loaded models are
  // reused, only genuinely-different ones load a second time.
  const startSeparatedLive = useCallback(async (): Promise<string | null> => {
    const endpointId =
      window.localStorage.getItem("lst.live.input-endpoint") ?? "";
    if (endpointId === "") {
      return "Pick an input endpoint in the config dialog first.";
    }
    const sourceMode =
      (window.localStorage.getItem("lst.live.source-mode") as
        | LiveSourceMode
        | null) ?? "filipino";
    const targetLanguage =
      (window.localStorage.getItem("lst.live.target-language") as
        | TargetLanguage
        | null) ?? "en";
    const asrProvider =
      (window.localStorage.getItem("lst.live.asr-provider") as
        | AsrProvider
        | null) ?? "whisper-turbo";
    const translationProvider =
      (window.localStorage.getItem("lst.live.translation-provider") as
        | TranslationProvider
        | null) ?? "nllb";
    await separatedLive.start(
      endpointId,
      null,
      asrProvider !== "groq-whisper" &&
        (translationProvider === "madlad" ||
          translationProvider === "nllb" ||
          translationProvider === "opus-mt-en-zh" ||
          translationProvider === "opus-mt-zh-en")
        ? "local"
        : "http",
      false,
      sourceMode,
      targetLanguage,
      asrProvider,
      translationProvider,
    );
    return separatedLive.error;
  }, [separatedLive]);

  const stopSeparatedLive = useCallback(async () => {
    await separatedLive.stop();
  }, [separatedLive]);

  const minimize = () => {
    if (desktop) {
      void getCurrentWindow().minimize();
    }
  };

  const close = () => {
    if (!desktop) return;
    // The Rust side destroys the whole app (sidecar + overlay + window) when
    // the control window receives a close request, so a plain close is enough.
    getCurrentWindow()
      .close()
      .catch((error: unknown) => {
        console.error("window close rejected:", error);
      });
  };

  if (controller.windowedMode) {
    const historyView = controller.snapshot.historyView;
    const maxRows = controller.snapshot.settings.historyMaxRows;
    const shownHistory =
      maxRows === "auto"
        ? history.activeEntries
        : history.activeEntries.slice(-maxRows);
    const reversedHistory = [...shownHistory].reverse();

    // Mini history needs a taller window than the caption strip (150px).
    const toggleWindowedHistory = (): void => {
      controller.toggleHistoryView();
      void getCurrentWindow()
        .setSize(new PhysicalSize(900, historyView ? 150 : 420))
        .catch(() => undefined);
    };
    return (
      <main
        className="windowed-overlay"
        data-history={historyView || undefined}
      >
        <div className="windowed-overlay-controls">
          <button
            type="button"
            className="windowed-overlay-button"
            aria-label={language.t("overlayDragLabel")}
            title={language.t("overlayDragLabel")}
            onPointerDown={() => {
              void beginOverlayDrag();
            }}
          >
            <GripHorizontal aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="windowed-overlay-button"
            aria-label={language.t("overlayToggleHistory")}
            title={language.t("overlayToggleHistory")}
            onClick={toggleWindowedHistory}
          >
            <ScrollText aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className={`windowed-overlay-button${controller.snapshot.settings.pinned ? " on" : ""}`}
            aria-label={language.t("overlayPinLabel")}
            title={language.t("overlayPinLabel")}
            onClick={controller.pin}
          >
            <Pin aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="windowed-overlay-button"
            aria-label={language.t("overlayExitWindowed")}
            title={language.t("overlayExitWindowed")}
            onClick={controller.toggleWindowedMode}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
        {historyView ? (
          <div className="overlay-history windowed-history">
            {history.activeEntries.length === 0 ? (
              <p className="overlay-history-empty">
                {language.t("overlayHistoryEmpty")}
              </p>
            ) : (
              <ol className="overlay-history-list">
                {reversedHistory.map((entry) => (
                  <li
                    key={entry.id}
                    className={`overlay-history-entry ${entry.fromSelf ? "self" : ""}`}
                    data-uncertain={entry.uncertain || undefined}
                  >
                    <span className="overlay-history-text">{entry.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <CaptionStack snapshot={controller.snapshot} mode="mini" />
        )}
      </main>
    );
  }

  return (
    <main className="app-frame">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-brand-card" data-tauri-drag-region>
          <img
            className="titlebar-icon"
            src="app-icon.png"
            alt="yTRSL"
            draggable={false}
          />
          <span className="titlebar-beta">BETA</span>
        </span>
        {desktop && (
          <div className="window-actions">
            <span className="lst-model-count pill titlebar-history-count">
              {historyCount}
            </span>
            <button
              type="button"
              aria-label={language.t("overlayToggleHistory")}
              title={language.t("overlayToggleHistory")}
              onClick={controller.toggleHistoryView}
            >
              <ScrollText aria-hidden="true" size={15} />
            </button>
            <button
              type="button"
              aria-label={language.t("overlayEnterWindowed")}
              title={language.t("overlayEnterWindowed")}
              onClick={controller.toggleWindowedMode}
            >
              <PictureInPicture2 aria-hidden="true" size={15} />
            </button>
            <button type="button" aria-label="Minimize" onClick={minimize}>
              <Minus aria-hidden="true" size={15} />
            </button>
            <button type="button" aria-label="Close" onClick={close}>
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="app-body">
        <aside className="sidebar">
          <nav className="sidebar-nav" aria-label="Sections">
            {navItems(language.t).map((item) => {
              const Icon = NAV_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-button ${section === item.id ? "active" : ""}`}
                  aria-label={item.label}
                  aria-current={section === item.id ? "page" : undefined}
                  title={item.label}
                  onClick={() => {
                    setSection(item.id);
                  }}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
                </button>
              );
            })}
            <span className="sidebar-nav-spacer" aria-hidden="true" />
            <button
              type="button"
              className={`nav-button ${section === "about" ? "active" : ""}`}
              aria-label={language.t("navAbout")}
              aria-current={section === "about" ? "page" : undefined}
              title={language.t("navAbout")}
              onClick={() => {
                setSection("about");
              }}
            >
              <Info aria-hidden="true" size={20} strokeWidth={1.9} />
            </button>
          </nav>
        </aside>

        <section className="content" aria-label="Active section">
          {section === "live" && (
            <LivePage
              controller={controller}
              audio={audio}
              live={live}
              models={models}
              sessionIdHint={history.currentSessionId}
              onRequestStop={requestStop}
              micSource={youSource}
            />
          )}
          {section === "profile" && (
            <ProfilePage
              audio={audio}
              live={live}
              sessionIdHint={history.currentSessionId}
            />
          )}
          {section === "about" && <AboutPanel version={APP_VERSION} />}
          {section === "models" && (
            <ModelsPage models={models} gpuRuntime={gpuRuntime} />
          )}
          {section === "history" && (
            <div className="page-stack history-page-stack">
              <HistoryPanel
                sessions={history.sessions}
                currentSessionId={history.currentSessionId}
                onRenameSession={history.renameSession}
                onDeleteSession={history.deleteSession}
                onClearSession={history.clearSession}
                onCountChange={setHistoryCount}
                micEnabled={live.snapshot.micEnabled}
                micConfigured={youConfig.micEndpointId !== null}
                liveRunning={live.state === "listening"}
                onToggleMic={toggleMic}
                onSendChat={sendChat}
                onOpenYouConfig={() => { setYouConfigOpen(true); }}
                separatedState={separatedLive.state}
                separatedError={separatedLive.error}
                onStartSeparatedLive={startSeparatedLive}
                onStopSeparatedLive={stopSeparatedLive}
              />
            </div>
          )}
          {section === "sources" && (
            <div className="page-stack">
              <SourcesPanel />
            </div>
          )}
          {section === "settings" && (
            <SettingsPage controller={controller} language={language} />
          )}
          {section === "diagnostics" && (
            <DiagnosticsPage
              audio={audio}
              onCaption={ingestCaption}
              diagnostics={diagnostics}
              overlaySettings={controller.snapshot.settings}
            />
          )}
        </section>
      </div>

      {stopDialogOpen && (
        <div className="lst-modal-backdrop" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={language.t("liveStopConfirmTitle")}
            className="lst-modal"
          >
            <div className="lst-modal-head">
              <h3>{language.t("liveStopConfirmTitle")}</h3>
            </div>
            <p className="lst-modal-body">
              {history.activeSession !== null
                ? language
                    .t("liveStopConfirmBody")
                    .replace("{name}", history.activeSession.name)
                : language.t("liveStopConfirmBodyShort")}
            </p>
            <div className="lst-modal-actions">
              <button
                className="button primary btn-shine"
                type="button"
                autoFocus
                onClick={() => { resolveStop(true); }}
              >
                {language.t("liveStopEnd")}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => { resolveStop(false); }}
              >
                {language.t("liveStopKeep")}
              </button>
              <button
                className="button quiet"
                type="button"
                onClick={() => { setStopDialogOpen(false); }}
              >
                {language.t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {desktop && showWelcome && (
        <WelcomeModelsDialog
          models={models}
          error={models.error}
          onInstall={(id) => void models.startInstall(id)}
          onRetry={() => void models.refresh()}
          onDismiss={() => {
            setShowWelcome(false);
          }}
          language={language}
        />
      )}

      {youConfigOpen && (
        <YouConfigDialog
          endpoints={audio.catalog?.endpoints ?? []}
          installedModelIds={new Set(
            models.installed.map((model) => model.id),
          )}
          onSaved={(config) => { setYouConfig(config); }}
          onClose={() => { setYouConfigOpen(false); }}
        />
      )}
    </main>
  );
}

function ModelsPage({
  models,
  gpuRuntime,
}: {
  models: ModelsController;
  gpuRuntime: GpuRuntimeController;
}) {
  return (
    <div className="page-stack">
      <ModelsPanel models={models} gpuRuntime={gpuRuntime} />
    </div>
  );
}

function LivePage({
  controller,
  audio,
  live,
  models,
  sessionIdHint,
  onRequestStop,
  micSource,
}: {
  controller: Controller;
  audio: AudioController;
  live: LiveController;
  models: ModelsController;
  sessionIdHint: string | null;
  onRequestStop: () => void;
  micSource: LiveSourceRequest | null;
}) {
  const { snapshot } = controller;
  const t = useT();
  const [overlayCustomizeOpen, setOverlayCustomizeOpen] = useState(false);

  return (
    <div className="page-stack">
      {controller.windowError !== null && (
        <section className="inline-alert error" role="alert">
          <div>
            <strong>{t("overlayUnavailable")}</strong>
            <p>{controller.windowError}</p>
          </div>
          <button
            className="button quiet"
            type="button"
            onClick={controller.retryWindowSync}
          >
            {t("retry")}
          </button>
        </section>
      )}

      {controller.recoveredPlacement && (
        <section className="inline-alert" role="status">
          <div>
            <strong>{t("overlayMoved")}</strong>
            <p>{t("overlayMovedNote")}</p>
          </div>
        </section>
      )}

      <LiveTranslationPanel
        audio={audio}
        live={live}
        models={models}
        sessionIdHint={sessionIdHint}
        onRequestStop={onRequestStop}
        micSource={micSource}
      />

      <section className="card" aria-labelledby="overlay-customize">
        <div className="card-head">
          <h2 className="card-title" id="overlay-customize">
            {t("overlayCustomize")}
          </h2>
          <button
            className="button quiet"
            type="button"
            aria-expanded={overlayCustomizeOpen}
            onClick={() => {
              setOverlayCustomizeOpen((current) => !current);
            }}
          >
            {overlayCustomizeOpen
              ? t("overlayCustomizeHide")
              : t("overlayCustomizeShow")}
          </button>
        </div>
        {overlayCustomizeOpen && (
          <OverlaySettingsPanel
            snapshot={snapshot}
            onUpdateSettings={controller.updateSettings}
            onSetTranslationEnabled={controller.setTranslationEnabled}
            onToggleEditMode={controller.toggleEditMode}
            onResetPlacement={controller.resetPlacement}
          />
        )}
      </section>

      <section className="card" aria-labelledby="preview-title">
        <div className="card-head">
          <h2 className="card-title" id="preview-title">
            {t("settingsOnScreenCaptions")}
          </h2>
          <span className={`pill ${snapshot.mode === "edit" ? "on" : ""}`}>
            <span aria-hidden="true" />
            {snapshot.mode === "edit"
              ? t("overlayEditMode")
              : t("overlayPlayMode")}
          </span>
        </div>

        <div className="preview-stage">
          <CaptionStack preview snapshot={snapshot} />
        </div>

        <div className="action-row">
          <button
            className="button primary"
            type="button"
            disabled={!snapshot.translationEnabled}
            onClick={controller.sendFakeCaption}
          >
            Preview sample caption
          </button>
          {snapshot.visible ? (
            <button
              className="button secondary"
              type="button"
              onClick={controller.hideOverlay}
            >
              {t("settingsHideOverlay")}
            </button>
          ) : (
            <button
              className="button secondary"
              type="button"
              onClick={controller.showOverlay}
            >
              {t("settingsShowOverlay")}
            </button>
          )}
          <button
            className="button secondary"
            type="button"
            onClick={controller.toggleEditMode}
          >
            {snapshot.mode === "edit"
              ? t("overlayFinishEditing")
              : t("overlayEditPosition")}
          </button>
          <button
            className="button quiet"
            type="button"
            onClick={controller.clearCaptions}
          >
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsPage({
  controller,
  language,
}: {
  controller: Controller;
  language: LanguageController;
}) {
  const { snapshot } = controller;
  const { t, setLanguage } = language;
  const appTheme = useAppThemeValue();

  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="appearance-theme">
        <div className="card-head">
          <h2 className="card-title" id="appearance-theme">
            {t("settingsAppearance")}
          </h2>
        </div>
        <div className="settings-block">
          <div className="field">
            <span>{t("settingsThemeNote")}</span>
            <Select
              id="appearance-theme-picker"
              label={t("settingsTheme")}
              value={appTheme}
              onChange={(value) => {
                setAppTheme(value as "dark" | "light");
              }}
              options={[
                { value: "dark", label: t("themeDark") },
                { value: "light", label: t("themeLight") },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="interface-language">
        <div className="card-head">
          <h2 className="card-title" id="interface-language">
            {t("settingsInterfaceLanguage")}
          </h2>
        </div>
        <div className="settings-block">
          <div className="field">
            <span>{t("settingsInterfaceLanguageNote")}</span>
            <Select
              id="interface-language-picker"
              label={t("settingsInterfaceLanguage")}
              value={language.language}
              onChange={(value) => {
                setLanguage(value as "en" | "zh");
              }}
              options={[
                { value: "en", label: t("english") },
                { value: "zh", label: t("chineseSimplified") },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="hotkeys-title">
        <div className="card-head">
          <h2 className="card-title" id="hotkeys-title">
            {t("settingsHotkeys")}
          </h2>
        </div>
        <HotkeyPanel
          hotkeys={snapshot.settings.hotkeys}
          registrationErrors={controller.hotkeyErrors}
          onSave={controller.updateHotkeys}
        />
      </section>

      <ClipLabPanel />
    </div>
  );
}

function DiagnosticsPage({
  audio,
  onCaption,
  diagnostics,
  overlaySettings,
}: {
  audio: AudioController;
  onCaption: Controller["ingestCaption"];
  diagnostics: DiagnosticsController;
  overlaySettings: OverlaySettings;
}) {
  return (
    <div className="page-stack">
      <DiagnosticsPanel
        snapshot={diagnostics.snapshot}
        sourceConfigs={loadSourceConfigs()}
        overlaySettings={overlaySettings}
        appVersion={APP_VERSION}
        platform={audio.catalog?.platform ?? "unknown"}
        onRunLeakage={() => void diagnostics.runLeakage()}
      />
      <AudioDevicePanel audio={audio} />
      <RoutingPanel />
      {captionTrustEnabled() && <AccuracyLabPanel />}
      {captionTrustEnabled() && <CaptionTrustPanel />}
      <IpcPanel onCaption={onCaption} />
    </div>
  );
}
