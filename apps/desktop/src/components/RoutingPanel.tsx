import { AudioLines, CircleAlert, Headphones, Square } from "lucide-react";

import { useRoutingTest } from "../routing/useRoutingTest";

export function RoutingPanel() {
  const routing = useRoutingTest();
  const isSimulator = routing.platform === "development";

  return (
    <section
      className="audio-card"
      id="routing"
      aria-labelledby="routing-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">
            {isSimulator ? "macOS bench routing" : "Windows live routing"}
          </p>
          <h2 id="routing-title">
            {isSimulator ? "Silent pipeline simulator" : "Monitoring and inference branch"}
          </h2>
          <p className="section-description">
            {isSimulator
              ? "A generated signal flows through the real bounded queues and resampler into a silent memory sink. You will not hear audio."
              : "Monitoring keeps native channels while a separate bounded branch downmixes and resamples to 16 kHz mono."}
          </p>
        </div>
        <span className="mode-badge">
          {routing.active ? "Routing active" : "Stopped"}
        </span>
      </div>

      {routing.error !== null && (
        <div className="inline-alert error phase-note" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Routing test unavailable</strong>
            <p>{routing.error}</p>
          </div>
        </div>
      )}

      <div className="routing-grid">
        <div className="field">
          <label htmlFor="routing-capture">
            {isSimulator ? "Generated input" : "Capture source"}
          </label>
          <select
            id="routing-capture"
            value={routing.captureId}
            onChange={(event) => {
              routing.setCaptureId(event.currentTarget.value);
            }}
          >
            <option value="">Choose capture…</option>
            {routing.captures.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.friendlyName}
              </option>
            ))}
          </select>
        </div>
        <div className="route-arrow" aria-hidden="true">
          →
        </div>
        <div className="field">
          <label htmlFor="routing-playback">
            {isSimulator ? "Silent output sink" : "Monitoring output"}
          </label>
          <select
            id="routing-playback"
            value={routing.playbackId}
            onChange={(event) => {
              routing.setPlaybackId(event.currentTarget.value);
            }}
          >
            <option value="">Choose headphones…</option>
            {routing.playbacks.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.friendlyName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="routing-meter-row">
        <div className="meter-panel">
          <div className="meter-label">
            <span>
              <Headphones aria-hidden="true" size={16} />
              {isSimulator ? "Simulated monitor branch" : "Monitor branch"}
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
            {isSimulator ? "Simulated monitor gain" : "Monitor volume"}
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
            {isSimulator ? "Run pipeline simulator" : "Start routing"}
          </button>
        )}
        <span className="capture-safety">
          {isSimulator
            ? "Generated input · silent sink · no audible playback"
            : "Ordinary Windows audio endpoints only"}
        </span>
      </div>
    </section>
  );
}
