import { getCurrentWindow } from "@tauri-apps/api/window";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { analyzeMediaClip } from "../clip/bridge";
import {
  formatTimestamp,
  type ClipResult,
  type SourceMode,
} from "../clip/model";
import { useT } from "../features/i18n/store";
import { isDesktopRuntime } from "../overlay/bridge";
import { Select } from "./Select";

const ACCEPTED_EXTENSIONS = /\.(aac|flac|m4a|mkv|mov|mp3|mp4|ogg|wav|webm)$/i;

export function ClipLabPanel() {
  const [path, setPath] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("mixed");
  const [provider, setProvider] = useState<"demo" | "local">("demo");
  const [state, setState] = useState<"idle" | "running" | "complete">("idle");
  const [result, setResult] = useState<ClipResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") {
          return;
        }
        const selected = event.payload.paths.find((candidate) =>
          ACCEPTED_EXTENSIONS.test(candidate),
        );
        if (selected !== undefined) {
          setPath(selected);
          setResult(null);
          setError(null);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const displayName = path?.split(/[\\/]/).at(-1) ?? t("clipDropPlaceholder");

  const analyze = async () => {
    if (path === null) {
      return;
    }
    setState("running");
    setError(null);
    setResult(null);
    try {
      setResult(await analyzeMediaClip(path, sourceMode, provider));
      setState("complete");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("idle");
    }
  };

  return (
    <section
      className="audio-card clip-lab glass-panel"
      id="clips"
      aria-labelledby="clip-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="clip-title">{t("clipLabTitle")}</h2>
        </div>
        <span className={`mode-badge ${provider === "demo" ? "edit" : ""}`}>
          {provider === "demo" ? t("clipDemoProviders") : t("clipLocalModels")}
        </span>
      </div>

      <div className="clip-controls">
        <button
          className={`clip-dropzone ${path === null ? "" : "selected"}`}
          type="button"
          onClick={() => {
            if (!isDesktopRuntime()) {
              setPath("browser-demo.mp4");
            }
          }}
        >
          <span>
            <strong>{displayName}</strong>
          </span>
        </button>
        <div className="field">
          <label htmlFor="clip-language">{t("clipSourceSpeech")}</label>
          <Select
            id="clip-language"
            label={t("clipSourceSpeech")}
            value={sourceMode}
            onChange={(value) => {
              setSourceMode(value as SourceMode);
            }}
            options={[
              { value: "mixed", label: "Tagalog-first" },
              { value: "filipino", label: "Filipino" },
              { value: "cebuano", label: "Cebuano" },
              { value: "chinese", label: "Chinese" },
            ]}
          />
        </div>
        <div className="field">
          <label htmlFor="clip-provider">{t("clipInference")}</label>
          <Select
            id="clip-provider"
            label={t("clipInference")}
            value={provider}
            onChange={(value) => {
              setProvider(value as "demo" | "local");
            }}
            options={[
              { value: "demo", label: t("clipDemoPlumbing") },
              { value: "local", label: t("clipVerifiedLocal") },
            ]}
          />
        </div>
      </div>

      {error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>{t("clipAnalyzeFailed")}</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="action-row">
        <button
          className="button primary"
          type="button"
          disabled={path === null || state === "running"}
          aria-busy={state === "running"}
          onClick={() => void analyze()}
        >
          {state === "running" ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : null}
          {state === "running" ? t("clipAnalyzing") : t("clipAnalyze")}
        </button>
        <span className="capture-safety">{t("clipSafety")}</span>
      </div>

      {result !== null && (
        <div className="clip-results" aria-live="polite">
          <div className="clip-result-summary">
            <strong>{result.metadata.display_name}</strong>
            <span>
              {result.captions.length} speech segment
              {result.captions.length === 1 ? "" : "s"} ·{" "}
              {result.metadata.duration_seconds.toFixed(1)} sec
            </span>
          </div>
          {result.captions.length === 0 ? (
            <p className="clip-empty">{t("clipNoSegments")}</p>
          ) : (
            <ol>
              {result.captions.map((caption) => (
                <li key={caption.utterance_id}>
                  <time>
                    {formatTimestamp(caption.start_ms)}–
                    {formatTimestamp(caption.end_ms)}
                  </time>
                  <div>
                    <span>{caption.source_text}</span>
                    <strong>{caption.english_text}</strong>
                  </div>
                  <small>
                    {result.mode === "demo" ? "Demo" : "Local"} ·{" "}
                    {caption.provider}
                    {caption.warnings.includes("LOW_CONFIDENCE")
                      ? ` · ${t("clipLowConfidence")}`
                      : ""}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
