import { Activity, Download, Gauge, Layers, ShieldCheck, ShieldX } from "lucide-react";

import { type DiagnosticsSnapshot } from "../diagnostics/model";
import { schedulerCoalescingRate } from "../diagnostics/model";
import {
  buildSupportBundle,
  serializeContentFree,
} from "../diagnostics/supportBundle";
import type { SourceConfigs } from "../sources/model";
import type { OverlaySettings } from "../overlay/model";

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="diag-metric">
      <span className="diag-metric-value">{value}</span>
      <span className="diag-metric-label">{label}</span>
    </div>
  );
}

function SourceDiagnosticCard({
  source,
  displayName,
  tag,
}: {
  source: NonNullable<DiagnosticsSnapshot["sources"]>[number];
  displayName: string;
  tag: string;
}) {
  return (
    <article className="diag-source-card" data-active={source.active || undefined}>
      <div className="diag-source-head">
        <h4>
          <span className="diag-source-tag">{tag}</span> {displayName}
        </h4>
        <span className={`pill ${source.active ? "on" : ""}`}>
          <span aria-hidden="true" />
          {source.active ? "Active" : "Stopped"}
        </span>
      </div>
      <div className="diag-metric-row">
        <Metric label="Packets" value={source.packetsReceived} />
        <Metric label="Utterances" value={source.utterancesCompleted} />
        <Metric label="Captions" value={source.captionsEmitted} />
        <Metric label="Dropped" value={source.utterancesDropped} />
      </div>
      {source.filter !== undefined && (
        <div className="diag-metric-row">
          <Metric label="Filtered" value={source.filter.applied} />
          <Metric label="Suppressed" value={source.filter.suppressed} />
          <Metric label="Flagged" value={source.filter.flagged} />
          <Metric label="Passed" value={source.filter.passed} />
        </div>
      )}
      {source.lowConfidenceCaptions > 0 && (
        <p className="diag-hint warn">
          {source.lowConfidenceCaptions} low-confidence caption
          {source.lowConfidenceCaptions === 1 ? "" : "s"}
        </p>
      )}
    </article>
  );
}

export function DiagnosticsPanel({
  snapshot,
  sourceConfigs,
  overlaySettings,
  appVersion,
  platform,
  onExport,
  onRunLeakage,
}: {
  snapshot: DiagnosticsSnapshot;
  sourceConfigs: SourceConfigs | null;
  overlaySettings: OverlaySettings;
  appVersion: string;
  platform: string;
  onExport?: (json: string) => void;
  onRunLeakage?: () => void;
}) {
  const displayName = new Map(
    (sourceConfigs?.sources ?? []).map((source) => [source.sourceId, source.displayName]),
  );
  const tag = new Map(
    (sourceConfigs?.sources ?? []).map((source) => [source.sourceId, source.captionTag]),
  );
  const scheduler = snapshot.scheduler;

  const exportBundle = () => {
    const bundle = buildSupportBundle({
      appVersion,
      platform,
      diagnostics: snapshot,
      sourceConfigs,
      overlaySettings,
    });
    const json = serializeContentFree(bundle);
    if (onExport !== undefined) {
      onExport(json);
    }
  };

  return (
    <section className="card" aria-labelledby="diagnostics-title">
      <div className="card-head">
        <h2 className="card-title" id="diagnostics-title">
          Diagnostics
        </h2>
        <button
          className="button quiet"
          type="button"
          onClick={exportBundle}
          aria-label="Export support bundle"
        >
          <Download aria-hidden="true" size={15} />
          Export support bundle
        </button>
      </div>

      {scheduler !== undefined && (
        <div className="diag-block">
          <div className="section-heading">
            <Gauge aria-hidden="true" size={16} />
            <h3>Scheduler</h3>
          </div>
          <div className="diag-metric-row">
            <Metric label="Queue depth" value={scheduler.queueDepth} />
            <Metric
              label="Oldest queued"
              value={`${String(scheduler.oldestQueuedMs)} ms`}
            />
            <Metric label="Avg delay" value={`${String(scheduler.avgQueueDelayMs)} ms`} />
            <Metric label="Max delay" value={`${String(scheduler.maxQueueDelayMs)} ms`} />
          </div>
          <div className="diag-metric-row">
            <Metric label="Finals" value={scheduler.finalsCompleted} />
            <Metric label="Provisionals" value={scheduler.provisionalsCompleted} />
            <Metric
              label="Coalescing"
              value={`${String(Math.round(schedulerCoalescingRate(scheduler) * 100))}%`}
            />
            <Metric label="Overloads" value={scheduler.overloadEvents} />
          </div>
          {(scheduler.provisionalsDropped > 0 || scheduler.finalsDropped > 0) && (
            <p className="diag-hint warn">
              {scheduler.provisionalsDropped} provisional{scheduler.provisionalsDropped === 1 ? "" : "s"} and{" "}
              {scheduler.finalsDropped} final{scheduler.finalsDropped === 1 ? "" : "s"} dropped under load
            </p>
          )}
        </div>
      )}

      <div className="diag-block">
        <div className="section-heading">
          <Layers aria-hidden="true" size={16} />
          <h3>Sources</h3>
        </div>
        {snapshot.sources.length === 0 ? (
          <p className="diag-empty">
            No active sources. Start a live session to see per-source metrics.
          </p>
        ) : (
          <div className="diag-source-grid">
            {snapshot.sources.map((source) => (
              <SourceDiagnosticCard
                key={source.sourceId}
                source={source}
                displayName={displayName.get(source.sourceId) ?? "Source"}
                tag={tag.get(source.sourceId) ?? "SRC"}
              />
            ))}
          </div>
        )}
      </div>

      {snapshot.leakage !== undefined && (
        <div className="diag-block">
          <div className="section-heading">
            {snapshot.leakage.passed ? (
              <ShieldCheck aria-hidden="true" size={16} />
            ) : (
              <ShieldX aria-hidden="true" size={16} />
            )}
            <h3>Isolation check</h3>
            {onRunLeakage !== undefined && (
              <button
                className="button quiet"
                type="button"
                onClick={onRunLeakage}
              >
                Run again
              </button>
            )}
          </div>
          <div className={`inline-alert ${snapshot.leakage.passed ? "ok" : "error"}`}>
            <div>
              <strong>
                {snapshot.leakage.passed
                  ? "No cross-source leakage detected"
                  : "Leakage detected"}
              </strong>
              <p>{snapshot.leakage.detail}</p>
            </div>
          </div>
        </div>
      )}

      <p className="diag-footnote">
        <Activity aria-hidden="true" size={13} />
        Metrics only — no transcripts are shown or exported.
      </p>
    </section>
  );
}
