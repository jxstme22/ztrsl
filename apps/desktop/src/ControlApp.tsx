import { Minus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { AudioDevicePanel } from "./components/AudioDevicePanel";
import { CaptionStack } from "./components/CaptionStack";
import { ClipLabPanel } from "./components/ClipLabPanel";
import { HotkeyPanel } from "./components/HotkeyPanel";
import { IpcPanel } from "./components/IpcPanel";
import { LiveTranslationPanel } from "./components/LiveTranslationPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { useAudioMeter } from "./audio/useAudioMeter";
import { isDesktopRuntime } from "./overlay/bridge";
import { useOverlayController } from "./overlay/useOverlayController";
import { getLiquidGlassStatus } from "./windowEffects";

type SectionId = "live" | "overlay" | "hotkeys" | "cliplab" | "diagnostics";

type Controller = ReturnType<typeof useOverlayController>;
type AudioController = ReturnType<typeof useAudioMeter>;

const NAV_ITEMS: readonly { id: SectionId; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "overlay", label: "Overlay" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "cliplab", label: "Clip Lab" },
  { id: "diagnostics", label: "Diagnostics" },
];

export function ControlApp() {
  const controller = useOverlayController();
  const audio = useAudioMeter();
  const desktop = isDesktopRuntime();
  const [section, setSection] = useState<SectionId>("live");
  const [glassStatus, setGlassStatus] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    void getLiquidGlassStatus().then((status) => {
      if (!cancelled) {
        setGlassStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <span className="titlebar-title">Local Squad Translator</span>
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
          <h1 className="app-title">Translation console</h1>
          <nav className="sidebar-nav" aria-label="Sections">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-button ${section === item.id ? "active" : ""}`}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => {
                  setSection(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="privacy-card" id="privacy">
              <div>
                <strong>Private by default</strong>
                <p>
                  No cloud processing, recording, transcript history,
                  telemetry, or game-process access.
                </p>
              </div>
            </div>
            <p className="glass-status">Glass: {glassStatus}</p>
          </div>
        </aside>

        <section className="content" aria-label="Active section">
          {section === "live" && (
            <LivePage controller={controller} audio={audio} />
          )}
          {section === "overlay" && <OverlayPage controller={controller} />}
          {section === "hotkeys" && <HotkeysPage controller={controller} />}
          {section === "cliplab" && <ClipLabPage />}
          {section === "diagnostics" && (
            <DiagnosticsPage
              audio={audio}
              onCaption={controller.ingestCaption}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function LivePage({
  controller,
  audio,
}: {
  controller: Controller;
  audio: AudioController;
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

      <LiveTranslationPanel
        audio={audio}
        onCaption={controller.ingestCaption}
      />

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

function OverlayPage({ controller }: { controller: Controller }) {
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
    </div>
  );
}

function HotkeysPage({ controller }: { controller: Controller }) {
  const { snapshot } = controller;
  return (
    <div className="page-stack">
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
    </div>
  );
}

function ClipLabPage() {
  return (
    <div className="page-stack">
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
