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
import { LiveTranslationPanel } from "./components/LiveTranslationPanel";
import { RoutingPanel } from "./components/RoutingPanel";
import { useAudioMeter } from "./audio/useAudioMeter";
import { isDesktopRuntime } from "./overlay/bridge";
import { useOverlayController } from "./overlay/useOverlayController";

export function ControlApp() {
  const controller = useOverlayController();
  const audio = useAudioMeter();
  const { snapshot } = controller;

  return (
    <main className="control-shell">
      <header className="console-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Captions size={21} />
          </span>
          <div>
            <strong>Local Squad</strong>
            <span>Translator</span>
          </div>
        </div>

        <nav className="console-nav" aria-label="Console modules">
          <a className="nav-item active" href="#live">
            <AudioLines aria-hidden="true" size={17} />
            Live translation
          </a>
          <a className="nav-item" href="#clips">
            <FileVideo2 aria-hidden="true" size={17} />
            Clip lab
          </a>
          <a className="nav-item" href="#overlay">
            <LayoutPanelTop aria-hidden="true" size={17} />
            Subtitle monitor
          </a>
          <a className="nav-item" href="#hardware">
            <AudioLines aria-hidden="true" size={17} />
            Diagnostics
          </a>
          <a className="nav-item" href="#settings">
            <Move aria-hidden="true" size={17} />
            Calibration
          </a>
        </nav>

        <div className="runtime-pill">
          <span aria-hidden="true" />
          {isDesktopRuntime() ? "Local engine" : "Browser preview"}
        </div>
      </header>

      <section className="control-content" id="overlay">
        <header className="page-header">
          <div>
            <p className="eyebrow">Local translation instrument · Revision 05</p>
            <h1>Translation console</h1>
            <p>
              Translate incoming Tagalog squad conversations into readable
              English subtitles without sending voice data off this device.
            </p>
          </div>
          <div className="console-serial" aria-label="Console status">
            <span>LST–4070</span>
            <strong>LOCAL / ARMED</strong>
          </div>
        </header>

        <section className="status-bridge" aria-label="Privacy and platform status">
          <div>
            <span className="status-lamp ready" aria-hidden="true" />
            <p>
              <strong>Local models</strong>
              <small>Whisper large-v3 + MADLAD</small>
            </p>
          </div>
          <div>
            <span className="status-lamp standby" aria-hidden="true" />
            <p>
              <strong>Live voice capture</strong>
              <small>
                {audio.catalog?.platform === "development"
                  ? "Simulated on this Mac"
                  : "Windows endpoint ready"}
              </small>
            </p>
          </div>
          <div>
            <span className="status-lamp ready" aria-hidden="true" />
            <p>
              <strong>Retention</strong>
              <small>Raw audio storage off</small>
            </p>
          </div>
        </section>

        <LiveTranslationPanel
          audio={audio}
          onCaption={controller.ingestCaption}
        />

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
              Preview sample caption
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

        <details className="diagnostics-bay" id="hardware">
          <summary>
            <span className="status-lamp standby" aria-hidden="true" />
            <span>
              <strong>Advanced diagnostics</strong>
              <small>
                Audio meter, route health, and local inference connection
              </small>
            </span>
            <span className="diagnostics-bay__action">Open service bay</span>
          </summary>
          <section
            className="hardware-bay"
            aria-labelledby="hardware-title"
          >
            <div className="bay-label">
              <span>Service bay 02</span>
              <div>
                <h2 id="hardware-title">Audio pipeline diagnostics</h2>
                <p>
                  Use these instruments when selecting or troubleshooting an
                  audio route. On macOS, they run generated signals only.
                </p>
              </div>
            </div>
            <AudioDevicePanel audio={audio} />
            <RoutingPanel />
            <IpcPanel onCaption={controller.ingestCaption} />
          </section>
        </details>

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
                <p>Pause English subtitles without hiding the overlay.</p>
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

        <footer className="privacy-card" id="privacy">
          <ShieldCheck aria-hidden="true" size={18} />
          <div>
            <strong>Private by default</strong>
            <p>
              No cloud processing, recording, transcript history, telemetry, or
              game-process access.
            </p>
          </div>
        </footer>
      </section>
    </main>
  );
}
