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
import { Select } from "./Select";
import type { UiLanguageController } from "../features/i18n/useUiLanguage";
import type { ModelInfo } from "../models/model";
import type { ModelUiState } from "../models/useModels";

const STEPS: readonly {
  number: string;
  icon: typeof Ear;
  title: "welcomeListen" | "welcomeTranslate" | "welcomePrivate";
  text: "welcomeListenText" | "welcomeTranslateText" | "welcomePrivateText";
}[] = [
  { number: "1", icon: Ear, title: "welcomeListen", text: "welcomeListenText" },
  {
    number: "2",
    icon: Languages,
    title: "welcomeTranslate",
    text: "welcomeTranslateText",
  },
  { number: "3", icon: Lock, title: "welcomePrivate", text: "welcomePrivateText" },
];

function ChoiceCard({
  model,
  models,
  onInstall,
  t,
}: {
  model: ModelInfo;
  models: ModelUiState;
  onInstall: (id: string) => void;
  t: (
    key:
      | "install"
      | "cancel"
      | "recommended"
      | "welcomeSpeechRecognition"
      | "welcomeTranslation",
  ) => string;
}) {
  const progress = models.progress[model.id];
  const installing = progress !== undefined && !progress.done;
  const failed = progress?.done === true && progress.error !== null;
  return (
    <article className="lst-model-card lst-welcome-card">
      <div className="lst-model-card-head">
        <h3>{model.name}</h3>
        {model.recommended && <span className="lst-badge">{t("recommended")}</span>}
      </div>
      <p className="lst-model-description">{model.description}</p>
      <div className="lst-model-meta">
        <span>
          {model.kind === "asr"
            ? t("welcomeSpeechRecognition")
            : t("welcomeTranslation")}
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
            {t("cancel")}
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
            {t("install")}
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
  language,
}: {
  models: ModelUiState;
  onInstall: (id: string) => void;
  error: string | null;
  onRetry: () => void;
  language: UiLanguageController;
}) {
  const [showOptional, setShowOptional] = useState(false);
  const { t, setLanguage } = language;
  const recommended = models.available.filter((model) => model.recommended);
  const others = models.available.filter((model) => !model.recommended);

  return (
    <div className="lst-welcome-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("welcomeTitle")}
        className="lst-welcome"
      >
        <div className="lst-welcome-accent" aria-hidden="true" />
        <div className="lst-welcome-head">
          <span className="lst-welcome-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2>{t("welcomeTitle")}</h2>
            <p className="lst-welcome-sub">{t("welcomeSub")}</p>
          </div>
        </div>

        <div className="field lst-welcome-language">
          <span>{t("welcomeChooseLanguage")}</span>
          <Select
            id="welcome-language"
            label={t("welcomeChooseLanguage")}
            value={language.language}
            onChange={(value) => {
              setLanguage(value as "en" | "zh");
            }}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "简体中文" },
            ]}
          />
        </div>

        <ol className="lst-welcome-steps" aria-label={t("welcomeSub")}>
          {STEPS.map(({ number, icon: Icon, title, text }) => (
            <li key={number}>
              <span className="lst-welcome-step-number" aria-hidden="true">
                {number}
              </span>
              <Icon aria-hidden="true" size={15} />
              <div>
                <strong>{t(title)}</strong>
                <span>{t(text)}</span>
              </div>
            </li>
          ))}
        </ol>

        {models.loading ? (
          <div className="lst-welcome-loading" role="status">
            <span className="lst-spinner" aria-hidden="true" />
            {t("welcomeReadingCatalog")}
          </div>
        ) : error !== null ? (
          <div className="lst-welcome-error" role="alert">
            <div>
              <strong>{t("welcomeCatalogError")}</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={onRetry}
            >
              <RotateCw aria-hidden="true" size={14} />
              {t("retry")}
            </button>
          </div>
        ) : (
          <>
            <div className="lst-welcome-pick">
              <h3 className="section-heading">{t("welcomePickModels")}</h3>
              <p>{t("welcomePickText")}</p>
            </div>

            <section
              className="lst-model-section"
              aria-label={t("recommended")}
            >
              <div className="lst-model-grid">
                {recommended.map((model) => (
                  <ChoiceCard
                    key={model.id}
                    model={model}
                    models={models}
                    onInstall={onInstall}
                    t={t}
                  />
                ))}
              </div>
            </section>

            {others.length > 0 && (
              <section
                className="lst-model-section lst-welcome-optional"
                aria-label={t("welcomeShowOptional")}
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
                  {t("welcomeShowOptional")} ({others.length})
                </button>
                {showOptional && (
                  <div className="lst-model-grid lst-welcome-optional-grid">
                    {others.map((model) => (
                      <ChoiceCard
                        key={model.id}
                        model={model}
                        models={models}
                        onInstall={onInstall}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <p className="lst-welcome-foot">{t("welcomeFoot")}</p>
      </div>
    </div>
  );
}
