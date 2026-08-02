import { HardDriveDownload, ShieldCheck } from "lucide-react";

import { formatBytes } from "./ModelsPanel";
import type { ModelInfo } from "../models/model";
import type { ModelUiState } from "../models/useModels";
import { ProgressBar } from "./ModelsPanel";

export function WelcomeModelsDialog({
  models,
  onInstall,
  error,
}: {
  models: ModelUiState;
  onInstall: (id: string) => void;
  error: string | null;
}) {
  const recommended = models.available.filter((model) => model.recommended);
  const others = models.available.filter((model) => !model.recommended);

  const ChoiceCard = ({ model }: { model: ModelInfo }) => {
    const progress = models.progress[model.id];
    const installing = progress !== undefined && !progress.done;
    return (
      <article className="lst-model-card lst-welcome-card">
        <div className="lst-model-card-head">
          <h3>{model.name}</h3>
          {model.recommended && <span className="lst-badge">Recommended</span>}
        </div>
        <p className="lst-model-description">{model.description}</p>
        <div className="lst-model-meta">
          <span>{model.kind === "asr" ? "Speech recognition" : "Translation"}</span>
          <span>·</span>
          <span>{formatBytes(model.downloadSizeBytes)}</span>
          <span>·</span>
          <span>{model.licenseSpdx}</span>
        </div>
        {installing && <ProgressBar event={progress} />}
        <div className="lst-model-card-actions">
          {installing ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => { void models.cancel(model.id); }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              onClick={() => { onInstall(model.id); }}
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
        <div className="lst-welcome-head">
          <ShieldCheck aria-hidden="true" size={22} />
          <h2>Welcome to xTRSNLTR</h2>
        </div>
        <p className="lst-welcome-copy">
          This translator runs entirely on your machine. Nothing is installed
          with the app — you choose which speech and translation models to
          download, and you're shown the size and license before anything is
          fetched. Start with the two recommended models; you can add or remove
          models any time in the <strong>Models</strong> tab.
        </p>

        <section className="lst-model-section" aria-label="Recommended models">
          <h3 className="section-heading">Recommended</h3>
          <div className="lst-model-grid">{recommended.map((m) => <ChoiceCard key={m.id} model={m} />)}</div>
        </section>

        <section className="lst-model-section" aria-label="Optional models">
          <h3 className="section-heading">Optional</h3>
          <div className="lst-model-grid">{others.map((m) => <ChoiceCard key={m.id} model={m} />)}</div>
        </section>

        {error !== null && <p className="lst-error-text">{error}</p>}
      </div>
    </div>
  );
}
