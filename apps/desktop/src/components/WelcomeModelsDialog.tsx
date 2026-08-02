import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Ear,
  HardDriveDownload,
  Languages,
  Lock,
  RotateCw,
  ShieldCheck,
} from "lucide-react";

import { formatBytes, ProgressBar } from "./ModelsPanel";
import type { ModelInfo } from "../models/model";
import type { ModelUiState } from "../models/useModels";

const STEPS: readonly {
  number: string;
  icon: typeof Ear;
  title: string;
  text: string;
}[] = [
  { number: "1", icon: Ear, title: "Listen", text: "Captures voice chat" },
  {
    number: "2",
    icon: Languages,
    title: "Translate",
    text: "Tagalog & Cebuano to English",
  },
  { number: "3", icon: Lock, title: "Private", text: "Runs on this PC" },
];

function ChoiceCard({
  model,
  models,
  onInstall,
}: {
  model: ModelInfo;
  models: ModelUiState;
  onInstall: (id: string) => void;
}) {
  const progress = models.progress[model.id];
  const installing = progress !== undefined && !progress.done;
  const failed = progress?.done === true && progress.error !== null;
  return (
    <article className="lst-model-card lst-welcome-card">
      <div className="lst-model-card-head">
        <h3>{model.name}</h3>
        {model.recommended && <span className="lst-badge">Recommended</span>}
      </div>
      <p className="lst-model-description">{model.description}</p>
      <div className="lst-model-meta">
        <span>
          {model.kind === "asr" ? "Speech recognition" : "Translation"}
        </span>
        <span>·</span>
        <span>{formatBytes(model.downloadSizeBytes)}</span>
        <span>·</span>
        <span>{model.licenseSpdx}</span>
      </div>
      {installing && <ProgressBar event={progress} />}
      {failed && <p className="lst-error-text">{progress.error}</p>}
      <div className="lst-model-card-actions">
        {installing ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              void models.cancel(model.id);
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              onInstall(model.id);
            }}
          >
            <HardDriveDownload aria-hidden="true" size={14} />
            Install
          </button>
        )}
      </div>
    </article>
  );
}

export function WelcomeModelsDialog({
  models,
  onInstall,
  error,
  onRetry,
}: {
  models: ModelUiState;
  onInstall: (id: string) => void;
  error: string | null;
  onRetry: () => void;
}) {
  const [showOptional, setShowOptional] = useState(false);
  const recommended = models.available.filter((model) => model.recommended);
  const others = models.available.filter((model) => !model.recommended);

  return (
    <div className="lst-welcome-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to xTRSNLTR"
        className="lst-welcome"
      >
        <div className="lst-welcome-accent" aria-hidden="true" />
        <div className="lst-welcome-head">
          <span className="lst-welcome-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2>Welcome to xTRSNLTR</h2>
            <p className="lst-welcome-sub">
              VALORANT voice chat, captioned in English — on this PC.
            </p>
          </div>
        </div>

        <ol className="lst-welcome-steps" aria-label="How it works">
          {STEPS.map(({ number, icon: Icon, title, text }) => (
            <li key={number}>
              <span className="lst-welcome-step-number" aria-hidden="true">
                {number}
              </span>
              <Icon aria-hidden="true" size={15} />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ol>

        {models.loading ? (
          <div className="lst-welcome-loading" role="status">
            <span className="lst-spinner" aria-hidden="true" />
            Reading the model catalog…
          </div>
        ) : error !== null ? (
          <div className="lst-welcome-error" role="alert">
            <div>
              <strong>Could not load the model catalog.</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={onRetry}
            >
              <RotateCw aria-hidden="true" size={14} />
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="lst-welcome-pick">
              <h3 className="section-heading">Pick your models</h3>
              <p>
                Start with the recommended pair. Downloads are verified and can
                be changed anytime in the Models tab.
              </p>
            </div>

            <section
              className="lst-model-section"
              aria-label="Recommended models"
            >
              <div className="lst-model-grid">
                {recommended.map((model) => (
                  <ChoiceCard
                    key={model.id}
                    model={model}
                    models={models}
                    onInstall={onInstall}
                  />
                ))}
              </div>
            </section>

            {others.length > 0 && (
              <section
                className="lst-model-section lst-welcome-optional"
                aria-label="Optional models"
              >
                <button
                  type="button"
                  className="lst-welcome-toggle"
                  aria-expanded={showOptional}
                  onClick={() => {
                    setShowOptional((open) => !open);
                  }}
                >
                  {showOptional ? (
                    <ChevronDown aria-hidden="true" size={14} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={14} />
                  )}
                  Show {others.length} optional model
                  {others.length === 1 ? "" : "s"}
                </button>
                {showOptional && (
                  <div className="lst-model-grid lst-welcome-optional-grid">
                    {others.map((model) => (
                      <ChoiceCard
                        key={model.id}
                        model={model}
                        models={models}
                        onInstall={onInstall}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <p className="lst-welcome-foot">
          Installer is ready when at least one model is installed — you can
          start and stop subtitles from the Live tab.
        </p>
      </div>
    </div>
  );
}
