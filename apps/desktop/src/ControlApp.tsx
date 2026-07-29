import {
  Captions,
  CircleAlert,
  Eye,
  EyeOff,
  FlaskConical,
  LayoutPanelTop,
  MonitorUp,
  Move,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Zap,
  AudioLines,
  FileVideo2,
} from "lucide-react";

import { AudioDevicePanel } from "./components/AudioDevicePanel";
import { CaptionStack } from "./components/CaptionStack";
import { ClipLabPanel } from "./components/ClipLabPanel";
import { HotkeyPanel } from "./components/HotkeyPanel";
import { IpcPanel } from "./components/IpcPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { isDesktopRuntime } from "./overlay/bridge";
import { useOverlayController } from "./overlay/useOverlayController";

export function ControlApp() {
  const controller = useOverlayController();
  const { snapshot } = controller;

  return (
    <main className="control-shell">
      <aside className="sidebar" aria-label="Application status">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Captions size={21} />
          </span>
          <div>
            <strong>Local Squad</strong>
            <span>Translator</span>
          </div>
        </div>

        <nav aria-label="Prototype sections">
          <a className="nav-item active" href="#overlay">
            <LayoutPanelTop aria-hidden="true" size={17} />
            Overlay
          </a>
          <a className="nav-item" href="#audio">
            <AudioLines aria-hidden="true" size={17} />
            Audio meter
          </a>
          <a className="nav-item" href="#routing">
            <AudioLines aria-hidden="true" size={17} />
            Routing
          </a>
          <a className="nav-item" href="#inference">
            <Zap aria-hidden="true" size={17} />
            Fake inference
          </a>
          <a className="nav-item" href="#clips">
            <FileVideo2 aria-hidden="true" size={17} />
            Clip lab
          </a>
          <a className="nav-item" href="#settings">
            <MonitorUp aria-hidden="true" size={17} />
            Placement
          </a>
          <a className="nav-item" href="#privacy">
            <ShieldCheck aria-hidden="true" size={17} />
            Privacy
          </a>
        </nav>

        <div className="privacy-card" id="privacy">
          <ShieldCheck aria-hidden="true" size={18} />
          <div>
            <strong>Local-only prototype</strong>
            <p>No recording, playback, history, telemetry, or game access.</p>
          </div>
        </div>
      </aside>

      <section className="control-content" id="overlay">
        <header className="page-header">
          <div>
            <p className="eyebrow">Phase 1 · External overlay</p>
            <h1>Caption overlay</h1>
            <p>
              Test the complete provisional-to-final experience with synthetic
              captions before audio is connected.
            </p>
          </div>
          <div className="runtime-pill">
            <span aria-hidden="true" />
            {isDesktopRuntime() ? "Desktop runtime" : "Browser preview"}
          </div>
        </header>

        <AudioDevicePanel />
        <RoutingPanel />
        <IpcPanel onCaption={controller.ingestCaption} />
        <ClipLabPanel />

        {controller.windowError !== null && (
          <section className="inline-alert error" role="alert">
            <CircleAlert aria-hidden="true" size={18} />
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
          <section className="inline-alert info" role="status">
            <MonitorUp aria-hidden="true" size={18} />
            <div>
              <strong>Overlay moved to the primary display</strong>
              <p>
                The saved monitor was unavailable, so the overlay stayed
                visible.
              </p>
            </div>
          </section>
        )}

        <section className="preview-card" aria-labelledby="preview-title">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Live preview</p>
              <h2 id="preview-title">What players will read</h2>
            </div>
            <span className={`mode-badge ${snapshot.mode}`}>
              {snapshot.mode === "edit" ? "Edit mode" : "Play mode"}
            </span>
          </div>

          <div className="preview-stage">
            <div className="preview-hud" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <CaptionStack preview snapshot={snapshot} />
          </div>

          <div className="action-row">
            <button
              className="button primary"
              type="button"
              disabled={!snapshot.translationEnabled}
              onClick={controller.sendFakeCaption}
            >
              <FlaskConical aria-hidden="true" size={18} />
              Send fake caption
            </button>
            {snapshot.visible ? (
              <button
                className="button secondary"
                type="button"
                onClick={controller.hideOverlay}
              >
                <EyeOff aria-hidden="true" size={18} />
                Hide overlay
              </button>
            ) : (
              <button
                className="button secondary"
                type="button"
                onClick={controller.showOverlay}
              >
                <Eye aria-hidden="true" size={18} />
                Show overlay
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              onClick={controller.toggleEditMode}
            >
              <Move aria-hidden="true" size={18} />
              {snapshot.mode === "edit" ? "Finish editing" : "Edit position"}
            </button>
            <button
              className="button quiet"
              type="button"
              onClick={controller.clearCaptions}
            >
              <Trash2 aria-hidden="true" size={18} />
              Clear
            </button>
          </div>
        </section>

        <div className="content-grid" id="settings">
          <section className="settings-card" aria-labelledby="appearance-title">
            <div className="section-heading compact">
              <div>
                <p className="section-kicker">Appearance</p>
                <h2 id="appearance-title">Readable at a glance</h2>
              </div>
            </div>

            <div className="toggle-row">
              <div>
                <label htmlFor="translation-enabled">Translation preview</label>
                <p>Pause fake English output without hiding the overlay.</p>
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
                <label htmlFor="show-source">Show source line</label>
                <p>Display compact Tagalog or Cebuano text above English.</p>
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
                <label htmlFor="overlay-width">Overlay width</label>
                <output htmlFor="overlay-width">
                  {Math.round(snapshot.settings.widthNormalized * 100)}%
                </output>
              </div>
              <input
                id="overlay-width"
                type="range"
                min="0.4"
                max="0.7"
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
                <label htmlFor="background-opacity">Background contrast</label>
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

            <button
              className="button quiet reset-button"
              type="button"
              onClick={controller.resetPlacement}
            >
              <RotateCcw aria-hidden="true" size={17} />
              Reset safe position
            </button>
          </section>

          <section className="settings-card" aria-labelledby="behavior-title">
            <div className="section-heading compact">
              <div>
                <p className="section-kicker">Behavior</p>
                <h2 id="behavior-title">Input-safe by default</h2>
              </div>
            </div>

            <ul className="behavior-list">
              <li>
                <span className="behavior-icon">
                  <Zap aria-hidden="true" size={17} />
                </span>
                <div>
                  <strong>Caption updates never request focus</strong>
                  <p>The overlay only receives text and window-state events.</p>
                </div>
              </li>
              <li>
                <span className="behavior-icon">
                  <Move aria-hidden="true" size={17} />
                </span>
                <div>
                  <strong>Play mode ignores pointer input</strong>
                  <p>Edit mode is the only interactive overlay state.</p>
                </div>
              </li>
              <li>
                <span className="behavior-icon">
                  <MonitorUp aria-hidden="true" size={17} />
                </span>
                <div>
                  <strong>Position is normalized per monitor</strong>
                  <p>Missing displays recover to a visible primary position.</p>
                </div>
              </li>
            </ul>

            <HotkeyPanel
              hotkeys={snapshot.settings.hotkeys}
              registrationErrors={controller.hotkeyErrors}
              onSave={controller.updateHotkeys}
            />
          </section>
        </div>
      </section>
    </main>
  );
}
