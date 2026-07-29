import {
  Activity,
  AudioLines,
  CircleAlert,
  RefreshCw,
  Square,
} from "lucide-react";

import { useAudioMeter } from "../audio/useAudioMeter";

export function AudioDevicePanel() {
  const audio = useAudioMeter();
  const meterWidth = `${String(Math.min(100, audio.level.peak * 100))}%`;

  return (
    <section className="audio-card" id="audio" aria-labelledby="audio-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Phase 2 · Capture only</p>
          <h2 id="audio-title">Windows audio endpoint meter</h2>
          <p className="section-description">
            Choose a capture endpoint explicitly. This phase measures its input
            level and never plays audio back.
          </p>
        </div>
        <button
          className="button quiet"
          type="button"
          onClick={() => void audio.refresh()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          Refresh
        </button>
      </div>

      {audio.catalog?.platform === "development" && (
        <div className="inline-alert info phase-note" role="status">
          <AudioLines aria-hidden="true" size={18} />
          <div>
            <strong>Development source active</strong>
            <p>
              macOS uses deterministic synthetic audio. Windows will list real
              WASAPI capture endpoints here.
            </p>
          </div>
        </div>
      )}

      {audio.error !== null && (
        <div className="inline-alert error phase-note" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Audio meter unavailable</strong>
            <p>{audio.error}</p>
          </div>
        </div>
      )}

      <div className="audio-layout">
        <div className="field">
          <label htmlFor="capture-endpoint">Capture endpoint</label>
          <select
            id="capture-endpoint"
            value={audio.selectedEndpointId ?? ""}
            onChange={(event) => {
              audio.selectEndpoint(event.currentTarget.value || null);
            }}
          >
            <option value="">Choose an endpoint…</option>
            {audio.captureEndpoints.map((endpoint) => (
              <option
                key={endpoint.id}
                value={endpoint.id}
                disabled={endpoint.state !== "active"}
              >
                {endpoint.friendlyName}
                {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
              </option>
            ))}
          </select>
          <p>
            The stable Windows endpoint ID is stored locally only after you make
            a selection.
          </p>
        </div>

        <div className="meter-panel">
          <div className="meter-label">
            <span>
              <Activity aria-hidden="true" size={16} />
              Capture level
            </span>
            <output aria-live="polite">
              {audio.active
                ? `${String(Math.round(audio.level.peak * 100))}%`
                : "Off"}
            </output>
          </div>
          <div
            className="audio-meter"
            role="meter"
            aria-label="Capture level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(audio.level.peak * 100)}
          >
            <span
              className={audio.level.clipped ? "clipped" : ""}
              style={{ width: meterWidth }}
            />
          </div>
          <div className="meter-meta">
            <span>
              {audio.selectedEndpoint?.nativeFormat?.sampleRate ?? "—"} Hz
            </span>
            <span>
              {audio.selectedEndpoint?.nativeFormat?.channels ?? "—"} channel(s)
            </span>
            <span>{audio.level.droppedFrames} dropped</span>
          </div>
        </div>
      </div>

      <div className="action-row">
        {audio.active ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => void audio.stop()}
          >
            <Square aria-hidden="true" size={15} />
            Stop meter
          </button>
        ) : (
          <button
            className="button primary"
            type="button"
            disabled={audio.selectedEndpoint === null}
            onClick={() => void audio.start()}
          >
            <AudioLines aria-hidden="true" size={17} />
            Start meter
          </button>
        )}
        <span className="capture-safety">
          Capture meter only · no playback · no recording
        </span>
      </div>
    </section>
  );
}
