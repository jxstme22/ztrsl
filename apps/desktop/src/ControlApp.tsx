import {
  Activity,
  Boxes,
  Gauge,
  Mic,
  Minus,
  ScrollText,
  Settings,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { HistoryPanel } from "./captions/HistoryPanel";
import { useCaptionHistory } from "./captions/useCaptionHistory";
import { AudioDevicePanel } from "./components/AudioDevicePanel";
import { AccuracyLabPanel } from "./components/AccuracyLabPanel";
import { CaptionStack } from "./components/CaptionStack";
import { CaptionTrustPanel } from "./components/CaptionTrustPanel";
import { ClipLabPanel } from "./components/ClipLabPanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { HotkeyPanel } from "./components/HotkeyPanel";
import { IpcPanel } from "./components/IpcPanel";
import { LiveTranslationPanel } from "./components/LiveTranslationPanel";
import { ModelsPanel } from "./components/ModelsPanel";
import { OverlaySettingsPanel } from "./components/OverlaySettingsPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { Select } from "./components/Select";
import { SourcesPanel } from "./components/SourcesPanel";
import { WelcomeModelsDialog } from "./components/WelcomeModelsDialog";
import { SetupWizard } from "./setup/SetupWizard";
import { useAudioMeter } from "./audio/useAudioMeter";
import { useDiagnostics } from "./diagnostics/useDiagnostics";
import { useUiLanguage } from "./features/i18n/useUiLanguage";
import { useT } from "./features/i18n/store";
import { setAppTheme, useAppThemeValue } from "./features/theme/store";
import { useLiveTranslation } from "./live/useLiveTranslation";
import { useGpuRuntime } from "./models/useGpuRuntime";
import { useModels } from "./models/useModels";
import { isDesktopRuntime, emitHistoryToOverlay } from "./overlay/bridge";
import type { Caption, OverlaySettings } from "./overlay/model";
import { useOverlayController } from "./overlay/useOverlayController";
import { loadSourceConfigs } from "./sources/storage";
import { captionTrustEnabled } from "./sources/captionTrustFlag";
import { multiSourceEnabled } from "./sources/featureFlag";

type SectionId =
  | "live"
  | "models"
  | "history"
  | "settings"
  | "diagnostics"
  | "sources"
  | "setup";

const APP_VERSION = "0.6.5";

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
    { id: "models", label: t("navModels") },
    ...(multiSourceEnabled()
      ? ([
          { id: "setup", label: t("navSetup") },
          { id: "sources", label: t("navSources") },
        ] as const)
      : []),
    { id: "settings", label: t("navSettings") },
    { id: "diagnostics", label: t("navDiagnostics") },
  ];
}

const NAV_ICONS: Record<SectionId, LucideIcon> = {
  live: Activity,
  models: Boxes,
  history: ScrollText,
  setup: Wand2,
  sources: Mic,
  settings: Settings,
  diagnostics: Gauge,
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
      historyRef.current.record(caption, {
        displayName,
        audioSource: endpoint?.friendlyName ?? "",
      });
      controller.ingestCaption(caption);
    },
    [audio.catalog, controller],
  );
  const live = useLiveTranslation(ingestCaption);
  liveRef.current = live;
  const models = useModels();
  const gpuRuntime = useGpuRuntime();
  const diagnostics = useDiagnostics();
  const language = useUiLanguage();
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<SectionId>("live");
  // Show the welcome card only on a fresh install — when no models are
  // installed yet. Once the user has models, the welcome never reappears.
  const [showWelcome, setShowWelcome] = useState(
    () => !models.hasInstalledModels,
  );

  // Keep the overlay window's history view in sync (it also boots from the
  // same localStorage, so this only needs to run when entries change).
  useEffect(() => {
    if (desktop) {
      void emitHistoryToOverlay(history.entries);
    }
  }, [desktop, history.entries]);

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

  return (
    <main className="app-frame">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-brand">
          <span className="titlebar-title">yTRSLT</span>
          <span className="titlebar-badge">
            <span className="titlebar-beta">BETA</span>
            <span className="titlebar-version">v{APP_VERSION}</span>
          </span>
        </span>
        {desktop && (
          <div className="window-actions">
            <button
              type="button"
              aria-label={language.t("overlayToggleHistory")}
              title={language.t("overlayToggleHistory")}
              onClick={controller.toggleHistoryView}
            >
              <ScrollText aria-hidden="true" size={15} />
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
                  <Icon aria-hidden="true" size={22} strokeWidth={1.9} />
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="content" aria-label="Active section">
          {section === "live" && (
            <LivePage
              controller={controller}
              audio={audio}
              live={live}
              models={models}
            />
          )}
          {section === "models" && (
            <ModelsPage models={models} gpuRuntime={gpuRuntime} />
          )}
          {section === "history" && (
            <div className="page-stack">
              <HistoryPanel entries={history.entries} onClear={history.clear} />
            </div>
          )}
          {section === "sources" && (
            <div className="page-stack">
              <SourcesPanel />
            </div>
          )}
          {section === "setup" && (
            <div className="page-stack">
              <SetupWizard
                onFinish={() => {
                  setSection("sources");
                }}
              />
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
}: {
  controller: Controller;
  audio: AudioController;
  live: LiveController;
  models: ModelsController;
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

      <LiveTranslationPanel audio={audio} live={live} models={models} />

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
        platform="unknown"
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
