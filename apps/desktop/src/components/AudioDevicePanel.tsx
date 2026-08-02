import {
  Activity,
  AudioLines,
  CircleAlert,
  RefreshCw,
  Square,
} from "lucide-react";

import { useAudioMeter } from "../audio/useAudioMeter";
import { Select } from "./Select";

type AudioController = ReturnType<typeof useAudioMeter>;

type AudioDevicePanelProps = {
  audio: AudioController;
};

export function AudioDevicePanel({ audio }: AudioDevicePanelProps) {
  const meterWidth = `${String(Math.min(100, audio.level.peak * 100))}%`;
  const isSimulator = audio.catalog?.platform === "development";

  return (
    <section className="audio-card" id="audio" aria-labelledby="audio-title">
      <div className="section-heading">
        <div>
          <h2 id="audio-title">
            {isSimulator ? "Generated signal meter" : "Voice-chat input meter"}
          </h2>
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
        <div className="inline-alert" role="status">
          <div>
            <strong>Simulator — not a real audio device</strong>
            <p>
              Select the generated signal below to test the meter. Real incoming
              voice-chat devices appear only in the Windows build.
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
          <label htmlFor="capture-endpoint">
            {isSimulator ? "Generated test source" : "Capture endpoint"}
          </label>
          <Select
            id="capture-endpoint"
            label={isSimulator ? "Generated test source" : "Capture endpoint"}
            value={audio.selectedEndpointId ?? ""}
            placeholder="Choose an endpoint…"
            onChange={(value) => {
              audio.selectEndpoint(value || null);
            }}
            options={audio.captureEndpoints.map((endpoint) => ({
              value: endpoint.id,
              label: `${endpoint.friendlyName}${endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}`,
              disabled: endpoint.state !== "active",
            }))}
          />
        </div>

        <div className="meter-panel">
          <div className="meter-label">
            <span>
              <Activity aria-hidden="true" size={16} />
              {isSimulator ? "Generated level" : "Capture level"}
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
          {isSimulator
            ? "Generated in memory · no microphone · no playback"
            : "Capture meter only · no playback · no recording"}
        </span>
      </div>
    </section>
  );
}
