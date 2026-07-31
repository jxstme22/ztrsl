import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleAlert,
  FileVideo2,
  FlaskConical,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { analyzeMediaClip } from "../clip/bridge";
import {
  formatTimestamp,
  type ClipResult,
  type SourceMode,
} from "../clip/model";
import { isDesktopRuntime } from "../overlay/bridge";

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
    <section className="audio-card clip-lab" id="clips" aria-labelledby="clip-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Phase 5 · Offline clip lab</p>
          <h2 id="clip-title">Test a friends’ comms clip</h2>
          <p className="section-description">
            The selected file is decoded locally into memory, segmented, and
            discarded. Raw audio and transcripts are not saved.
          </p>
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
          <FileVideo2 aria-hidden="true" size={24} />
          <span>
            <strong>{displayName}</strong>
            <small>
              {isDesktopRuntime()
                ? "Drag and drop one user-approved clip here"
                : "Click to load a browser-only demonstration"}
            </small>
          </span>
        </button>
        <label className="field" htmlFor="clip-language">
          Source speech
          <select
            id="clip-language"
            value={sourceMode}
            onChange={(event) => {
              setSourceMode(event.currentTarget.value as SourceMode);
            }}
          >
            <option value="mixed">Tagalog-first mixed / code-switched</option>
            <option value="filipino">Filipino / Taglish</option>
            <option value="cebuano">Cebuano / Bislish</option>
          </select>
        </label>
        <label className="field" htmlFor="clip-provider">
          Inference
          <select
            id="clip-provider"
            value={provider}
            onChange={(event) => {
              setProvider(event.currentTarget.value as "demo" | "local");
            }}
          >
            <option value="demo">Demo plumbing</option>
            <option value="local">Verified local models</option>
          </select>
        </label>
      </div>

      <div className="inline-alert info phase-note" role="status">
        <FlaskConical aria-hidden="true" size={18} />
        <div>
          <strong>
            {provider === "demo"
              ? "Media and VAD are real; captions are clearly marked demo"
              : "Contextual Whisper ASR + reset-safe MADLAD translation"}
          </strong>
          <p>
            {provider === "demo"
              ? "This mode checks the pipeline without pretending it understood the speech."
              : sourceMode === "cebuano"
                ? "Cebuano is experimental: Whisper uses a Filipino decoder constraint to prevent script drift."
                : "Tagalog-first decoding preserves full-clip context and rejects unconstrained language guessing."}
          </p>
        </div>
      </div>

      {error !== null && (
        <div className="inline-alert error phase-note" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
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
            <LoaderCircle className="spin" aria-hidden="true" size={17} />
          ) : (
            <FileVideo2 aria-hidden="true" size={17} />
          )}
          {state === "running" ? "Analyzing locally…" : "Analyze clip"}
        </button>
        <span className="capture-safety">
          <ShieldCheck aria-hidden="true" size={14} /> Read-only · local-only ·
          memory-only
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
