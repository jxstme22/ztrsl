import {
  Activity,
  Boxes,
  Gauge,
  Minus,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { AudioDevicePanel } from "./components/AudioDevicePanel";
import { CaptionStack } from "./components/CaptionStack";
import { ClipLabPanel } from "./components/ClipLabPanel";
import { HotkeyPanel } from "./components/HotkeyPanel";
import { IpcPanel } from "./components/IpcPanel";
import { LiveTranslationPanel } from "./components/LiveTranslationPanel";
import { ModelsPanel } from "./components/ModelsPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { WelcomeModelsDialog } from "./components/WelcomeModelsDialog";
import { useAudioMeter } from "./audio/useAudioMeter";
import { useLiveTranslation } from "./live/useLiveTranslation";
import { useModels } from "./models/useModels";
import { isDesktopRuntime } from "./overlay/bridge";
import { useOverlayController } from "./overlay/useOverlayController";

type SectionId = "live" | "models" | "settings" | "diagnostics";

type Controller = ReturnType<typeof useOverlayController>;
type AudioController = ReturnType<typeof useAudioMeter>;
type LiveController = ReturnType<typeof useLiveTranslation>;
type ModelsController = ReturnType<typeof useModels>;

const NAV_ITEMS: readonly { id: SectionId; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "models", label: "Models" },
  { id: "settings", label: "Settings" },
  { id: "diagnostics", label: "Diagnostics" },
];

const NAV_ICONS: Record<SectionId, LucideIcon> = {
  live: Activity,
  models: Boxes,
  settings: Settings,
  diagnostics: Gauge,
};

export function ControlApp() {
  const controller = useOverlayController();
  const audio = useAudioMeter();
  const live = useLiveTranslation(controller.ingestCaption);
  const models = useModels();
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<SectionId>("live");

  const minimize = () => {
    if (desktop) {
      void getCurrentWindow().minimize();
    }
  };

  const close = () => {
    if (desktop) {
      void getCurrentWindow().close();
    }
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
            {NAV_ITEMS.map((item) => {
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
            <LivePage controller={controller} audio={audio} live={live} />
          )}
          {section === "models" && <ModelsPage models={models} />}
          {section === "settings" && <SettingsPage controller={controller} />}
          {section === "diagnostics" && (
            <DiagnosticsPage
              audio={audio}
              onCaption={controller.ingestCaption}
            />
          )}
        </section>
      </div>

      {desktop && !models.loading && !models.hasInstalledModels && (
        <WelcomeModelsDialog
          models={models}
          error={models.error}
          onInstall={(id) => void models.startInstall(id)}
        />
      )}
    </main>
  );
}

function ModelsPage({ models }: { models: ModelsController }) {
  return (
    <div className="page-stack">
      <ModelsPanel models={models} />
    </div>
  );
}

function LivePage({
  controller,
  audio,
  live,
}: {
  controller: Controller;
  audio: AudioController;
  live: LiveController;
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
            <p>The saved monitor was unavailable, so the overlay stayed visible.</p>
          </div>
        </section>
      )}

      <LiveTranslationPanel audio={audio} live={live} />

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

function SettingsPage({ controller }: { controller: Controller }) {
  const { snapshot } = controller;

  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="overlay-appearance">
        <div className="card-head">
          <h2 className="card-title" id="overlay-appearance">
            Overlay appearance
          </h2>
        </div>

        <div className="settings-block">
          <div className="toggles-row">
            <div className="toggle-row">
              <div>
                <label htmlFor="translation-enabled">Translation preview</label>
                <p>Pause subtitles without hiding the overlay.</p>
              </div>
              <input
                id="translation-enabled"
                className="switch"
                type="checkbox"
                checked={snapshot.translationEnabled}
                onChange={(event) => {
                  controller.setTranslationEnabled(
                    event.currentTarget.checked,
                  );
                }}
              />
            </div>
            <div className="toggle-row">
              <div>
                <label htmlFor="show-source">Show source line</label>
                <p>Original text above the English line.</p>
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

          <div className="sliders-grid">
            <div className="range-field">
              <div className="range-label">
                <label htmlFor="overlay-width">Width</label>
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
                <label htmlFor="font-scale">Text size</label>
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
                <label htmlFor="background-opacity">Background</label>
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
            Reset position
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="hotkeys-title">
        <div className="card-head">
          <h2 className="card-title" id="hotkeys-title">
            Hotkeys
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
}: {
  audio: AudioController;
  onCaption: Controller["ingestCaption"];
}) {
  return (
    <div className="page-stack">
      <AudioDevicePanel audio={audio} />
      <RoutingPanel />
      <IpcPanel onCaption={onCaption} />
    </div>
  );
}
