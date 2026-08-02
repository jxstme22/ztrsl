import { getCurrentWindow } from "@tauri-apps/api/window";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { analyzeMediaClip } from "../clip/bridge";
import {
  formatTimestamp,
  type ClipResult,
  type SourceMode,
} from "../clip/model";
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

  const displayName =
    path?.split(/[\\/]/).at(-1) ?? "Drop an MP4, MOV, MKV, or audio file";

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
    <section className="audio-card clip-lab glass-panel" id="clips" aria-labelledby="clip-title">
      <div className="section-heading">
        <div>
          <h2 id="clip-title">Test a friends’ comms clip</h2>
        </div>
        <span className={`mode-badge ${provider === "demo" ? "edit" : ""}`}>
          {provider === "demo" ? "Demo providers" : "Local models"}
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
          <label htmlFor="clip-language">Source speech</label>
          <Select
            id="clip-language"
            label="Source speech"
            value={sourceMode}
            onChange={(value) => {
              setSourceMode(value as SourceMode);
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
          <label htmlFor="clip-provider">Inference</label>
          <Select
            id="clip-provider"
            label="Inference"
            value={provider}
            onChange={(value) => {
              setProvider(value as "demo" | "local");
            }}
            options={[
              { value: "demo", label: "Demo plumbing" },
              { value: "local", label: "Verified local models" },
            ]}
          />
        </div>
      </div>

      {error !== null && (
        <div className="inline-alert error" role="alert">
          <div>
            <strong>Clip analysis failed</strong>
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
          {state === "running" ? "Analyzing locally…" : "Analyze clip"}
        </button>
        <span className="capture-safety">
          Read-only · local-only · memory-only
        </span>
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
            <p className="clip-empty">
              No speech-like segments were detected. Drop another clip or check
              that its audio is audible.
            </p>
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
                      ? " · Low confidence"
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
