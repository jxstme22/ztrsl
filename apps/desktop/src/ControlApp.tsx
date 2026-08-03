import {
  Activity,
  Boxes,
  Gauge,
  Mic,
  Minus,
  Settings,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

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
import { RoutingPanel } from "./components/RoutingPanel";
import { Select } from "./components/Select";
import { SourcesPanel } from "./components/SourcesPanel";
import { WelcomeModelsDialog } from "./components/WelcomeModelsDialog";
import { SetupWizard } from "./setup/SetupWizard";
import { useAudioMeter } from "./audio/useAudioMeter";
import { useDiagnostics } from "./diagnostics/useDiagnostics";
import { useUiLanguage } from "./features/i18n/useUiLanguage";
import { useLiveTranslation } from "./live/useLiveTranslation";
import { useGpuRuntime } from "./models/useGpuRuntime";
import { useModels } from "./models/useModels";
import { isDesktopRuntime } from "./overlay/bridge";
import type { OverlaySettings } from "./overlay/model";
import { useOverlayController } from "./overlay/useOverlayController";
import { loadSourceConfigs } from "./sources/storage";
import { captionTrustEnabled } from "./sources/captionTrustFlag";
import { multiSourceEnabled } from "./sources/featureFlag";

type SectionId =
  "live" | "models" | "settings" | "diagnostics" | "sources" | "setup";

const APP_VERSION = "0.5.0";

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
  setup: Wand2,
  sources: Mic,
  settings: Settings,
  diagnostics: Gauge,
};

export function ControlApp() {
  const controller = useOverlayController();
  const audio = useAudioMeter();
  const live = useLiveTranslation(controller.ingestCaption);
  const models = useModels();
  const gpuRuntime = useGpuRuntime();
  const diagnostics = useDiagnostics();
  const language = useUiLanguage();
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<SectionId>("live");
  // Show the welcome card when no models are installed, or on the very first
  // run (dismissible once). On later runs with models present, it stays
  // hidden so it never blocks the app.
  const [showWelcome, setShowWelcome] = useState(
    () =>
      !models.hasInstalledModels ||
      window.localStorage.getItem("lst.welcome-dismissed") !== "1",
  );

  const minimize = () => {
    if (desktop) {
      void getCurrentWindow().minimize();
    }
  };

  const close = () => {
    if (!desktop) return;
    getCurrentWindow()
      .close()
      .catch((error: unknown) => {
        console.error("window close rejected:", error);
      });
  };

  return (
    <main className="app-frame">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-title">xTRSNLTR</span>
        {desktop && (
          <div className="window-actions">
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
                  <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
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
              onCaption={controller.ingestCaption}
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
            window.localStorage.setItem("lst.welcome-dismissed", "1");
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

  return (
    <div className="page-stack">
      {controller.windowError !== null && (
        <section className="inline-alert error" role="alert">
          <div>
            <strong>Overlay unavailable</strong>
            <p>{controller.windowError}</p>
          </div>
          <button
            className="button quiet"
            type="button"
            onClick={controller.retryWindowSync}
          >
            Try again
          </button>
        </section>
      )}

      {controller.recoveredPlacement && (
        <section className="inline-alert" role="status">
          <div>
            <strong>Overlay moved to the primary display</strong>
            <p>
              The saved monitor was unavailable, so the overlay stayed visible.
            </p>
          </div>
        </section>
      )}

      <LiveTranslationPanel audio={audio} live={live} models={models} />

      <section className="card" aria-labelledby="preview-title">
        <div className="card-head">
          <h2 className="card-title" id="preview-title">
            On-screen captions
          </h2>
          <span className={`pill ${snapshot.mode === "edit" ? "on" : ""}`}>
            <span aria-hidden="true" />
            {snapshot.mode === "edit" ? "Edit mode" : "Play mode"}
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
              Hide overlay
            </button>
          ) : (
            <button
              className="button secondary"
              type="button"
              onClick={controller.showOverlay}
            >
              Show overlay
            </button>
          )}
          <button
            className="button secondary"
            type="button"
            onClick={controller.toggleEditMode}
          >
            {snapshot.mode === "edit" ? "Finish editing" : "Edit position"}
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
  const sources = useMemo(() => loadSourceConfigs().sources, []);

  return (
    <div className="page-stack">
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

      <section className="card" aria-labelledby="overlay-appearance">
        <div className="card-head">
          <h2 className="card-title" id="overlay-appearance">
            {t("settingsOverlayAppearance")}
          </h2>
        </div>

        <div className="settings-block">
          <div className="toggles-row">
            <div className="toggle-row">
              <div>
                <label htmlFor="translation-enabled">
                  {t("settingsTranslationPreview")}
                </label>
                <p>{t("settingsTranslationPreviewText")}</p>
              </div>
              <input
                id="translation-enabled"
                className="switch"
                type="checkbox"
                checked={snapshot.translationEnabled}
                onChange={(event) => {
                  controller.setTranslationEnabled(event.currentTarget.checked);
                }}
              />
            </div>
            <div className="toggle-row">
              <div>
                <label htmlFor="show-source">{t("settingsShowSource")}</label>
                <p>{t("settingsShowSourceText")}</p>
              </div>
              <input
                id="show-source"
                className="switch"
                type="checkbox"
                checked={snapshot.settings.showSource}
                onChange={(event) => {
                  controller.updateSettings({
                    showSource: event.currentTarget.checked,
                  });
                }}
              />
            </div>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Simultaneous captions</span>
              <Select
                id="simultaneous-policy"
                label={t("settingsSimultaneous")}
                value={snapshot.settings.simultaneousPolicy}
                onChange={(value) => {
                  controller.updateSettings({
                    simultaneousPolicy:
                      value as OverlaySettings["simultaneousPolicy"],
                  });
                }}
                options={[
                  { value: "show-both", label: t("settingsShowBoth") },
                  { value: "newest-wins", label: t("settingsNewestWins") },
                  { value: "primary-wins", label: t("settingsPrimaryWins") },
                ]}
              />
              <small className="field-note">
                {t("settingsSimultaneousNote")}
              </small>
            </label>

            <label className="field">
              <span>{t("settingsPrimarySource")}</span>
              <Select
                id="primary-source"
                label={t("settingsPrimarySource")}
                value={snapshot.settings.primarySourceId ?? ""}
                onChange={(value) => {
                  controller.updateSettings({
                    primarySourceId: value === "" ? null : value,
                  });
                }}
                options={[
                  { value: "", label: t("settingsAutoPrimary") },
                  ...sources.map((source) => ({
                    value: source.sourceId,
                    label: source.displayName,
                  })),
                ]}
              />
              <small className="field-note">
                {t("settingsPrimarySourceNote")}
              </small>
            </label>
          </div>

          {sources.length > 1 && (
            <div className="settings-block">
              <h3>Hidden sources</h3>
              {sources.map((source) => (
                <div className="toggle-row" key={source.sourceId}>
                  <div>
                    <label htmlFor={`hide-${source.sourceId}`}>
                      Hide {source.displayName}
                    </label>
                    <p>Stop this source's captions from appearing.</p>
                  </div>
                  <input
                    id={`hide-${source.sourceId}`}
                    className="switch"
                    type="checkbox"
                    checked={snapshot.settings.hiddenSourceIds.includes(
                      source.sourceId,
                    )}
                    onChange={(event) => {
                      const current = snapshot.settings.hiddenSourceIds;
                      controller.updateSettings({
                        hiddenSourceIds: event.currentTarget.checked
                          ? [...current, source.sourceId]
                          : current.filter((id) => id !== source.sourceId),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="sliders-grid">
            <div className="range-field">
              <div className="range-label">
                <label htmlFor="overlay-width">{t("settingsWidth")}</label>
                <output htmlFor="overlay-width">
                  {Math.round(snapshot.settings.widthNormalized * 100)}%
                </output>
              </div>
              <input
                id="overlay-width"
                type="range"
                min="0.3"
                max="0.95"
                step="0.01"
                value={snapshot.settings.widthNormalized}
                onChange={(event) => {
                  controller.updateSettings({
                    widthNormalized: Number(event.currentTarget.value),
                  });
                }}
              />
            </div>

            <div className="range-field">
              <div className="range-label">
                <label htmlFor="font-scale">{t("settingsTextSize")}</label>
                <output htmlFor="font-scale">
                  {Math.round(snapshot.settings.fontScale * 100)}%
                </output>
              </div>
              <input
                id="font-scale"
                type="range"
                min="0.8"
                max="1.6"
                step="0.1"
                value={snapshot.settings.fontScale}
                onChange={(event) => {
                  controller.updateSettings({
                    fontScale: Number(event.currentTarget.value),
                  });
                }}
              />
            </div>

            <div className="range-field">
              <div className="range-label">
                <label htmlFor="background-opacity">
                  {t("settingsBackground")}
                </label>
                <output htmlFor="background-opacity">
                  {Math.round(snapshot.settings.backgroundOpacity * 100)}%
                </output>
              </div>
              <input
                id="background-opacity"
                type="range"
                min="0.35"
                max="0.9"
                step="0.05"
                value={snapshot.settings.backgroundOpacity}
                onChange={(event) => {
                  controller.updateSettings({
                    backgroundOpacity: Number(event.currentTarget.value),
                  });
                }}
              />
            </div>
          </div>

          <button
            className="button quiet reset-button"
            type="button"
            onClick={controller.resetPlacement}
          >
            {t("settingsResetPosition")}
          </button>
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
