import { LoaderCircle, TestTube2 } from "lucide-react";
import { useState } from "react";

import { compareClips, type AccuracyConfig } from "../features/accuracy-lab/bridge";
import {
  ACCURACY_CONFIGS,
  type AccuracyLabReport,
} from "../features/accuracy-lab/model";
import { Select } from "./Select";

function RunTable({ report }: { report: AccuracyLabReport }) {
  return (
    <div className="acc-table-wrap">
      <table className="acc-table">
        <thead>
          <tr>
            <th>Configuration</th>
            <th>Model</th>
            <th>ASR</th>
            <th>MT</th>
            <th>Total</th>
            <th>Captions</th>
            <th>Critical</th>
          </tr>
        </thead>
        <tbody>
          {report.runs.map((run) => (
            <tr key={run.label} data-critical={run.criticalErrors > 0 || undefined}>
              <td>{run.label}</td>
              <td className="acc-model">{run.modelId}</td>
              <td>{Math.round(run.asrMs)} ms</td>
              <td>{Math.round(run.translationMs)} ms</td>
              <td>
                <strong>{Math.round(run.totalMs)} ms</strong>
              </td>
              <td>{run.captionCount}</td>
              <td>{run.criticalErrors}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.runs.some((run) => run.criticalErrors > 0) && (
        <p className="diag-hint warn">
          A configuration has critical tactical errors (wrong number / site /
          direction / negation / term / overlap). Annotate or compare before
          trusting it in-game.
        </p>
      )}
    </div>
  );
}

export function AccuracyLabPanel() {
  const [path, setPath] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState("mixed");
  const [selected, setSelected] = useState<string[]>(
    ACCURACY_CONFIGS.slice(0, 2).map((config) => config.label),
  );
  const [state, setState] = useState<"idle" | "running" | "complete">("idle");
  const [report, setReport] = useState<AccuracyLabReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const chosen: AccuracyConfig[] = ACCURACY_CONFIGS.filter((config) =>
    selected.includes(config.label),
  ).map((config) => ({
    asrName: config.asrName,
    translationName: config.translationName,
  }));

  const displayName =
    path?.split(/[\\/]/).at(-1) ?? "Drop an MP4, MOV, MKV, or audio file";

  const run = async () => {
    if (path === null || chosen.length === 0) {
      return;
    }
    setState("running");
    setError(null);
    setReport(null);
    setExported(false);
    try {
      setReport(await compareClips({ path, sourceMode, configs: chosen }));
      setState("complete");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("idle");
    }
  };

  const exportJson = () => {
    if (report === null) {
      return;
    }
    const serialized = JSON.stringify(report, null, 2);
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `accuracy-${String(Date.now())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };

  return (
    <section
      className="audio-card clip-lab glass-panel"
      id="accuracy-lab"
      aria-labelledby="accuracy-lab-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="accuracy-lab-title">Accuracy Lab</h2>
        </div>
        <span className="mode-badge edit">v0.4</span>
      </div>
      <p className="lst-page-description">
        Run one clip through several ASR/MT configurations and compare latency,
        caption counts, and critical tactical errors. Reports are content-free
        by default — transcripts are never exported.
      </p>

      <div className="clip-controls">
        <button
          className={`clip-dropzone ${path === null ? "" : "selected"}`}
          type="button"
          onClick={() => {
            setPath("browser-demo.mp4");
          }}
        >
          <span>
            <strong>{displayName}</strong>
          </span>
        </button>
        <div className="field">
          <label htmlFor="acc-language">Source speech</label>
          <Select
            id="acc-language"
            label="Source speech"
            value={sourceMode}
            onChange={(value) => {
              setSourceMode(value);
            }}
            options={[
              { value: "mixed", label: "Tagalog-first mixed / code-switched" },
              { value: "filipino", label: "Filipino / Taglish" },
              { value: "cebuano", label: "Cebuano / Bislish" },
              { value: "chinese", label: "Chinese (Mandarin/Cantonese)" },
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="acc-configs">Configurations</label>
          <Select
            id="acc-configs"
            label="Configurations"
            value={selected.join(",")}
            onChange={(value) => {
              setSelected(value.split(","));
            }}
            options={[
              {
                value: ACCURACY_CONFIGS.slice(0, 2)
                  .map((config) => config.label)
                  .join(","),
                label: "Recommended pair (Turbo + NLLB, Full + NLLB)",
              },
              {
                value: ACCURACY_CONFIGS.map((config) => config.label).join(","),
                label: "All installed configs",
              },
              { value: ACCURACY_CONFIGS[3]?.label ?? "Demo + Demo", label: "Demo + Demo" },
            ]}
          />
        </div>
      </div>

      {error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>Accuracy Lab run failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="action-row">
        <button
          className="button primary"
          type="button"
          disabled={path === null || chosen.length === 0 || state === "running"}
          aria-busy={state === "running"}
          onClick={() => void run()}
        >
          {state === "running" ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : (
            <TestTube2 aria-hidden="true" size={16} />
          )}
          {state === "running" ? "Comparing…" : "Compare configs"}
        </button>
        {report !== null && (
          <button className="button quiet" type="button" onClick={exportJson}>
            Export JSON
          </button>
        )}
        <span className="capture-safety">Local-only · no transcripts in exports</span>
      </div>

      {exported && <p className="lst-ok-text">Report exported (content-free).</p>}

      {report !== null && <RunTable report={report} />}
    </section>
  );
}
