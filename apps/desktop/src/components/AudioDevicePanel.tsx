import {
  Activity,
  AudioLines,
  CircleAlert,
  RefreshCw,
  Square,
} from "lucide-react";

import { useAudioMeter } from "../audio/useAudioMeter";
import { useT } from "../features/i18n/store";
import { Select } from "./Select";

type AudioController = ReturnType<typeof useAudioMeter>;

type AudioDevicePanelProps = {
  audio: AudioController;
};

export function AudioDevicePanel({ audio }: AudioDevicePanelProps) {
  const meterWidth = `${String(Math.min(100, audio.level.peak * 100))}%`;
  const isSimulator = audio.catalog?.platform === "development";
  const t = useT();

  return (
    <section className="audio-card" id="audio" aria-labelledby="audio-title">
      <div className="section-heading">
        <div>
          <h2 id="audio-title">
            {isSimulator ? t("audioGeneratedMeter") : t("audioInputMeter")}
          </h2>
        </div>
        <button
          className="button quiet"
          type="button"
          onClick={() => void audio.refresh()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("audioRefresh")}
        </button>
      </div>

      {audio.catalog?.platform === "development" && (
        <div className="inline-alert" role="status">
          <div>
            <strong>{t("audioSimulator")}</strong>
            <p>{t("audioSimulatorNote")}</p>
          </div>
        </div>
      )}

      {audio.error !== null && (
        <div className="inline-alert error phase-note" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>{t("audioMeterUnavailable")}</strong>
            <p>{audio.error}</p>
          </div>
        </div>
      )}

      <div className="audio-layout">
        <div className="field">
          <label htmlFor="capture-endpoint">
            {isSimulator
              ? t("audioGeneratedSource")
              : t("audioCaptureEndpoint")}
          </label>
          <Select
            id="capture-endpoint"
            label={
              isSimulator
                ? t("audioGeneratedSource")
                : t("audioCaptureEndpoint")
            }
            value={audio.selectedEndpointId ?? ""}
            placeholder={t("wizardChooseEndpoint")}
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
              {isSimulator ? t("audioGeneratedLevel") : t("audioCaptureLevel")}
            </span>
            <output aria-live="polite">
              {audio.active
                ? `${String(Math.round(audio.level.peak * 100))}%`
                : t("audioOff")}
            </output>
          </div>
          <div
            className="audio-meter"
            role="meter"
            aria-label={t("audioCaptureLevel")}
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
            <span>
              {audio.level.droppedFrames} {t("audioDropped")}
            </span>
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
            {t("audioStopMeter")}
          </button>
        ) : (
          <button
            className="button primary"
            type="button"
            disabled={audio.selectedEndpoint === null}
            onClick={() => void audio.start()}
          >
            <AudioLines aria-hidden="true" size={17} />
            {t("audioStartMeter")}
          </button>
        )}
        <span className="capture-safety">
          {isSimulator ? t("audioGeneratedSafety") : t("audioCaptureSafety")}
        </span>
      </div>
    </section>
  );
}
