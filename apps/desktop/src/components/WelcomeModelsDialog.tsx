import {
  HardDriveDownload,
  MousePointerClick,
  RotateCw,
  Scale,
  ShieldCheck,
} from "lucide-react";

import { formatBytes } from "./ModelsPanel";
import type { ModelInfo } from "../models/model";
import type { ModelUiState } from "../models/useModels";
import { ProgressBar } from "./ModelsPanel";

const FACTS: readonly { icon: typeof ShieldCheck; text: string }[] = [
  { icon: ShieldCheck, text: "Audio never leaves this PC" },
  { icon: MousePointerClick, text: "You choose what to download" },
  { icon: Scale, text: "License shown before install" },
];

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
  const recommended = models.available.filter((model) => model.recommended);
  const others = models.available.filter((model) => !model.recommended);

  const ChoiceCard = ({ model }: { model: ModelInfo }) => {
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
  };

  return (
    <div className="lst-welcome-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome — choose your models"
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

        <p className="lst-welcome-copy">
          Pick the speech recognition and translation models you want. They are
          downloaded to your machine and run locally; the app never sends your
          audio anywhere.
        </p>

        <ul className="lst-welcome-facts">
          {FACTS.map(({ icon: Icon, text }) => (
            <li key={text}>
              <Icon aria-hidden="true" size={13} />
              {text}
            </li>
          ))}
        </ul>

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
            <section
              className="lst-model-section"
              aria-label="Recommended models"
            >
              <h3 className="section-heading">Recommended</h3>
              <div className="lst-model-grid">
                {recommended.map((m) => (
                  <ChoiceCard key={m.id} model={m} />
                ))}
              </div>
            </section>

            <section className="lst-model-section" aria-label="Optional models">
              <h3 className="section-heading">Optional</h3>
              <div className="lst-model-grid">
                {others.map((m) => (
                  <ChoiceCard key={m.id} model={m} />
                ))}
              </div>
            </section>
          </>
        )}

        <p className="lst-welcome-foot">
          Downloads are checksum-verified and come from the pinned sources shown
          in the Models tab, where you can add or remove models any time.
        </p>
      </div>
    </div>
  );
}
