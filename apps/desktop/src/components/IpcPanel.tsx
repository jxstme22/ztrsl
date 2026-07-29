import {
  Activity,
  CircleAlert,
  Play,
  RefreshCw,
  Server,
  Square,
} from "lucide-react";

import { useSidecar } from "../ipc/useSidecar";
import type { Caption } from "../overlay/model";

type IpcPanelProps = {
  onCaption: (caption: Caption) => void;
};

export function IpcPanel({ onCaption }: IpcPanelProps) {
  const sidecar = useSidecar(onCaption);

  return (
    <section className="audio-card" id="inference" aria-labelledby="ipc-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Phase 4 · Local IPC</p>
          <h2 id="ipc-title">Authenticated fake inference</h2>
          <p className="section-description">
            A supervised Python sidecar accepts bounded binary audio only after
            a per-launch token handshake on 127.0.0.1.
          </p>
        </div>
        <span className={`sidecar-state ${sidecar.state}`}>
          <Activity aria-hidden="true" size={14} />
          {sidecar.state}
        </span>
      </div>

      {sidecar.error !== null && (
        <div className="inline-alert error phase-note" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Sidecar stopped unexpectedly</strong>
            <p>{sidecar.error}</p>
          </div>
          <button
            className="button quiet"
            type="button"
            onClick={() => void sidecar.start()}
          >
            <RefreshCw aria-hidden="true" size={16} />
            Restart
          </button>
        </div>
      )}

      <div className="ipc-summary">
        <div>
          <Server aria-hidden="true" size={19} />
          <span>
            <strong>Loopback only</strong>
            <small>Ephemeral port and launch token</small>
          </span>
        </div>
        <div>
          <Activity aria-hidden="true" size={19} />
          <span>
            <strong>
              {sidecar.lastLatencyMs === null
                ? "No roundtrip yet"
                : `${String(sidecar.lastLatencyMs)} ms fake latency`}
            </strong>
            <small>No models loaded</small>
          </span>
        </div>
      </div>

      <div className="action-row">
        {sidecar.state === "ready" ? (
          <>
            <button
              className="button primary"
              type="button"
              onClick={() => void sidecar.run()}
            >
              <Play aria-hidden="true" size={16} />
              Send fake audio end to end
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => void sidecar.stop()}
            >
              <Square aria-hidden="true" size={15} />
              Stop sidecar
            </button>
          </>
        ) : (
          <button
            className="button primary"
            type="button"
            disabled={sidecar.state === "starting"}
            onClick={() => void sidecar.start()}
          >
            <Server aria-hidden="true" size={17} />
            {sidecar.state === "starting" ? "Starting…" : "Start fake sidecar"}
          </button>
        )}
        <span className="capture-safety">
          No cloud · no models · no persisted token
        </span>
      </div>
    </section>
  );
}
