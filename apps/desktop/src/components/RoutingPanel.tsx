import { AudioLines, Headphones, Square } from "lucide-react";

import { useRoutingTest } from "../routing/useRoutingTest";
import { useT } from "../features/i18n/store";
import { Select } from "./Select";

export function RoutingPanel() {
  const routing = useRoutingTest();
  const isSimulator = routing.platform === "development";
  const t = useT();

  return (
    <section
      className="audio-card"
      id="routing"
      aria-labelledby="routing-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="routing-title">
            {isSimulator ? t("routingSimulatorTitle") : t("routingBranchTitle")}
          </h2>
        </div>
        <span className="mode-badge">
          {routing.active ? t("routingActive") : t("routingStopped")}
        </span>
      </div>

      {routing.error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>{t("routingUnavailable")}</strong>
            <p>{routing.error}</p>
          </div>
        </div>
      )}

      <div className="routing-grid">
        <div className="field">
          <label htmlFor="routing-capture">
            {isSimulator
              ? t("routingGeneratedInput")
              : t("routingCaptureSource")}
          </label>
          <Select
            id="routing-capture"
            label={
              isSimulator
                ? t("routingGeneratedInput")
                : t("routingCaptureSource")
            }
            value={routing.captureId}
            placeholder="Choose capture…"
            onChange={(value) => {
              routing.setCaptureId(value);
            }}
            options={routing.captures.map((endpoint) => ({
              value: endpoint.id,
              label: endpoint.friendlyName,
            }))}
          />
        </div>
        <div className="route-arrow" aria-hidden="true">
          →
        </div>
        <div className="field">
          <label htmlFor="routing-playback">
            {isSimulator
              ? t("routingSilentOutput")
              : t("routingMonitoringOutput")}
          </label>
          <Select
            id="routing-playback"
            label={
              isSimulator
                ? t("routingSilentOutput")
                : t("routingMonitoringOutput")
            }
            value={routing.playbackId}
            placeholder="Choose headphones…"
            onChange={(value) => {
              routing.setPlaybackId(value);
            }}
            options={routing.playbacks.map((endpoint) => ({
              value: endpoint.id,
              label: endpoint.friendlyName,
            }))}
          />
        </div>
      </div>

      <div className="routing-meter-row">
        <div className="meter-panel">
          <div className="meter-label">
            <span>
              <Headphones aria-hidden="true" size={16} />
              {isSimulator
                ? t("routingSimulatedMonitor")
                : t("routingMonitorBranch")}
            </span>
            <output>{Math.round(routing.snapshot.monitorPeak * 100)}%</output>
          </div>
          <div className="audio-meter" aria-hidden="true">
            <span
              style={{
                width: `${String(routing.snapshot.monitorPeak * 100)}%`,
              }}
            />
          </div>
        </div>
        <div className="routing-metrics" aria-label="Routing metrics">
          <span>
            <strong>{routing.snapshot.metrics.capturedFrames}</strong> frames
          </span>
          <span>
            <strong>{routing.snapshot.inferenceSamples}</strong> inference
            samples
          </span>
          <span>
            <strong>{routing.snapshot.metrics.monitorUnderruns}</strong>{" "}
            underruns
          </span>
          <span>
            <strong>{routing.snapshot.metrics.inferenceOverflows}</strong>{" "}
            inference drops
          </span>
        </div>
      </div>

      <div className="range-field monitor-volume">
        <div className="range-label">
          <label htmlFor="monitor-volume">
            {isSimulator
              ? t("routingSimulatedGain")
              : t("routingMonitorVolume")}
          </label>
          <output htmlFor="monitor-volume">
            {Math.round(routing.volume * 100)}%
          </output>
        </div>
        <input
          id="monitor-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={routing.volume}
          onChange={(event) => {
            routing.setVolume(Number(event.currentTarget.value));
          }}
        />
      </div>

      <div className="action-row">
        {routing.active ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => void routing.stop()}
          >
            <Square aria-hidden="true" size={15} />
            Stop routing
          </button>
        ) : (
          <button
            className="button primary"
            type="button"
            disabled={!routing.captureId || !routing.playbackId}
            onClick={() => void routing.start()}
          >
            <AudioLines aria-hidden="true" size={17} />
            {isSimulator ? t("routingRunSimulator") : t("routingStart")}
          </button>
        )}
        <span className="capture-safety">
          {isSimulator
            ? "Generated input · silent sink · no audible playback"
            : t("routingEndpointsOnly")}
        </span>
      </div>
    </section>
  );
}
