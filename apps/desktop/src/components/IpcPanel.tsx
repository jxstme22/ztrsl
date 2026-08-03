import { Activity, Play, RefreshCw, Server, Square } from "lucide-react";

import { useSidecar } from "../ipc/useSidecar";
import { useT } from "../features/i18n/store";
import type { Caption } from "../overlay/model";

type IpcPanelProps = {
  onCaption: (caption: Caption) => void;
};

export function IpcPanel({ onCaption }: IpcPanelProps) {
  const sidecar = useSidecar(onCaption);
  const t = useT();

  return (
    <section className="audio-card" id="inference" aria-labelledby="ipc-title">
      <div className="section-heading">
        <div>
          <h2 id="ipc-title">{t("ipcTitle")}</h2>
        </div>
        <span className={`sidecar-state ${sidecar.state}`}>
          <Activity aria-hidden="true" size={14} />
          {sidecar.state}
        </span>
      </div>

      {sidecar.error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>{t("ipcSidecarStopped")}</strong>
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
            <strong>{t("ipcLoopbackOnly")}</strong>
            <small>{t("ipcEphemeral")}</small>
          </span>
        </div>
        <div>
          <Activity aria-hidden="true" size={19} />
          <span>
            <strong>
              {sidecar.lastLatencyMs === null
                ? t("ipcNoRoundtrip")
                : `${String(sidecar.lastLatencyMs)} ms fake latency`}
            </strong>
            <small>{t("ipcNoModels")}</small>
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
            {sidecar.state === "starting"
              ? t("ipcStarting")
              : t("ipcStartFake")}
          </button>
        )}
        <span className="capture-safety">
          No cloud · no models · no persisted token
        </span>
      </div>
    </section>
  );
}
