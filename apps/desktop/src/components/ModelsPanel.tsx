import {
  Database,
  FolderOpen,
  HardDriveDownload,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { useT } from "../features/i18n/store";

import type { ModelInfo, ModelProgress } from "../models/model";
import type { ModelUiState } from "../models/useModels";
import { Select } from "./Select";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const magnitude = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const scaled = bytes / 1024 ** magnitude;
  const digits = magnitude === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  let formatted = scaled.toFixed(digits);
  if (formatted.endsWith(".00")) {
    formatted = formatted.slice(0, -3);
  }
  return `${formatted} ${units[magnitude] ?? ""}`;
}

function kindLabel(kind: string): string {
  return kind === "asr" ? "Speech recognition" : "Translation";
}

/** Honest capability labels (Phase 9, ADR-016): never overclaim a decoder
 * lock. `forced` means a fixed-language CTC model; `preferred`/`post-filter`
 * mean the decoder is multilingual and the language gate does the filtering. */
function capabilityLabel(languageCapability: string): string {
  switch (languageCapability) {
    case "forced":
      return "Fixed-language decoder";
    case "preferred":
      return "Language-biased (no hard lock)";
    default:
      return "Filters after recognition";
  }
}

function vramLabel(vramClass: string): string {
  switch (vramClass) {
    case "low":
      return "Low VRAM";
    case "medium":
      return "Medium VRAM";
    case "high":
      return "High VRAM";
    default:
      return vramClass;
  }
}

export function ProgressBar({ event }: { event: ModelProgress }) {
  const fraction =
    event.totalBytesTotal > 0
      ? event.totalBytesDone / event.totalBytesTotal
      : 0;
  const percent = Math.min(100, Math.round(fraction * 100));
  const label =
    event.phase === "download"
      ? "Downloading"
      : event.phase === "extract"
        ? "Extracting"
        : "Installing";
  return (
    <div className="lst-progress" role="progressbar" aria-valuenow={percent}>
      <div className="lst-progress-track">
        <div
          className="lst-progress-fill"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <span className="lst-progress-meta">
        {label} · {formatBytes(event.totalBytesDone)} /{" "}
        {formatBytes(event.totalBytesTotal)}
        {event.fileCount > 1 && event.phase === "download"
          ? " · file " +
            String(event.fileIndex + 1) +
            " of " +
            String(event.fileCount)
          : ""}
      </span>
    </div>
  );
}

export type DialogAction =
  | { kind: "install"; model: ModelInfo }
  | { kind: "delete"; model: ModelInfo }
  | null;

export function ConfirmModelDialog({
  action,
  inUse,
  error,
  onInstall,
  onDelete,
  onClose,
}: {
  action: Exclude<DialogAction, null>;
  inUse: boolean;
  error: string | null;
  onInstall: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { model } = action;
  const isDelete = action.kind === "delete";
  return (
    <div
      className="lst-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isDelete ? "Delete model" : "Install model"}
        className="lst-modal"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="lst-modal-head">
          <h3>
            {isDelete ? `Delete ${model.name}?` : `Install ${model.name}?`}
          </h3>
          <button
            type="button"
            className="button quiet"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        {isDelete ? (
          <p className="lst-modal-body">
            This removes <strong>{model.name}</strong> and frees{" "}
            <strong>{formatBytes(model.installedSizeBytes)}</strong>. You can
            reinstall it later.{" "}
            {inUse && "It is in use — stop the live session first."}
          </p>
        ) : (
          <>
            <p className="lst-modal-body">{model.description}</p>
            <dl className="lst-modal-details">
              <div>
                <dt>Type</dt>
                <dd>{kindLabel(model.kind)}</dd>
              </div>
              <div>
                <dt>Download size</dt>
                <dd>{formatBytes(model.downloadSizeBytes)}</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>
                  {model.licenseSpdx}
                  {model.licenseNotice ? (
                    <span className="lst-modal-note">
                      {" "}
                      — {model.licenseNotice}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd className="lst-modal-url">{model.source}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>
                  {model.fileCount} artifact{model.fileCount === 1 ? "" : "s"} ·
                  checksums verified
                </dd>
              </div>
            </dl>
          </>
        )}
        {error !== null && <p className="lst-error-text">{error}</p>}
        <div className="lst-modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {isDelete ? (
            <button
              type="button"
              className="button primary lst-danger"
              disabled={inUse}
              onClick={() => {
                onDelete(model.id);
              }}
            >
              <Trash2 aria-hidden="true" size={14} />
              Delete
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
              Download &amp; install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  progress,
  inUse,
  instantiating,
  localOnly = false,
  onInstallClick,
  onDeleteClick,
}: {
  model: ModelInfo;
  progress: ModelProgress | null;
  inUse: boolean;
  instantiating: boolean;
  /** v0.4: a locally-exported model (NCSpeech) — no download button. */
  localOnly?: boolean;
  onInstallClick: (model: ModelInfo) => void;
  onDeleteClick: (model: ModelInfo) => void;
}) {
  const installing = progress !== null && !progress.done;
  const installed = model.status === "installed";
  const finishedError =
    progress !== null && progress.done && progress.error !== null;
  return (
    <article
      className="lst-model-card"
      data-installed={installed || undefined}
    >
      <div className="lst-model-card-head">
        <h3>{model.name}</h3>
        {installed && (
          <span className="lst-badge lst-badge-installed">Installed</span>
        )}
        {model.recommended && <span className="lst-badge">Recommended</span>}
        {localOnly && (
          <span className="lst-badge lst-badge-local">Local export</span>
        )}
        {model.licenseSpdx === "CC-BY-NC-4.0" && (
          <span className="lst-badge lst-badge-warn">Non-commercial</span>
        )}
      </div>
      <p className="lst-model-description">{model.description}</p>
      <div className="lst-model-meta">
        <span>{kindLabel(model.kind)}</span>
        <span>·</span>
        <span>
          {installed
            ? `${formatBytes(model.installedSizeBytes)} on disk`
            : `${formatBytes(model.downloadSizeBytes)} download`}
        </span>
        <span>·</span>
        <span>{model.licenseSpdx}</span>
      </div>
      <div className="lst-model-meta">
        <span className="lst-capability">
          {capabilityLabel(model.capabilities.languageCapability)}
        </span>
        <span className="lst-capability">
          {vramLabel(model.capabilities.vramClass)}
        </span>
        {model.capabilities.recommendedProfiles.length > 0 && (
          <span className="lst-capability">
            {model.capabilities.recommendedProfiles.join(", ")}
          </span>
        )}
      </div>
      {installing && <ProgressBar event={progress} />}
      {finishedError && <p className="lst-error-text">{progress.error}</p>}
      <div className="lst-model-card-actions">
        {installed ? (
          <button
            type="button"
            className="button secondary"
            disabled={inUse || installing}
            title={inUse ? "In use by the live session" : undefined}
            onClick={() => {
              onDeleteClick(model);
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
            Delete
          </button>
        ) : installing ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              onInstallClick(model);
            }}
            aria-label={`Cancel install ${model.name}`}
          >
            Cancel
          </button>
        ) : localOnly ? (
          <span className="lst-model-local-hint">Requires local export</span>
        ) : (
          <button
            type="button"
            className={`button primary ${instantiating ? "disabled" : ""}`}
            disabled={instantiating}
            onClick={() => {
              onInstallClick(model);
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

function DownloadServerRow({ models }: { models: ModelUiState }) {
  const { downloadEndpoint, providerStatus } = models;
  const userPicked = downloadEndpoint.userOverride;
  const mirrorInUse = downloadEndpoint.mirror;
  return (
    <div className="lst-download-server">
      <div className="lst-download-server-copy">
        <label htmlFor="model-download-server">Download server</label>
        <p>
          {mirrorInUse
            ? `Downloads go through ${downloadEndpoint.endpoint}.`
            : userPicked
              ? "Downloads go through Hugging Face directly."
              : "Downloads go through Hugging Face directly. Set HF_ENDPOINT or LST_HF_ENDPOINT to use a mirror."}
        </p>
        {providerStatus.providers.length > 0 && (
          <p className="lst-provider-order">
            Provider order:{" "}
            {providerStatus.providers
              .map((provider) =>
                provider.custom ? provider.host : provider.name,
              )
              .join(" → ")}
          </p>
        )}
      </div>
      <Select
        id="model-download-server"
        label="Model download server"
        value={userPicked ? downloadEndpoint.endpoint : ""}
        onChange={(endpoint) => {
          void models.setDownloadEndpoint(endpoint);
        }}
        options={[
          { value: "", label: "Automatic" },
          {
            value: "https://hf-mirror.com",
            label: "hf-mirror.com (mainland China)",
          },
        ]}
      />
    </div>
  );
}

function OfflinePackRow({ models }: { models: ModelUiState }) {
  const [packDir, setPackDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runImport = async () => {
    if (packDir.trim() === "" || busy) {
      return;
    }
    setBusy(true);
    setImported(null);
    const ids = await models.importOfflinePack(packDir.trim());
    setBusy(false);
    setImported(ids);
    if (ids.length > 0) {
      setPackDir("");
    }
  };

  return (
    <div className="lst-download-server">
      <div className="lst-download-server-copy">
        <label htmlFor="model-offline-pack">Install offline model pack</label>
        <p>
          Point at a directory that already contains a manifest-verified model
          pack. Artifacts are SHA-256 checked and installed with no network.
        </p>
      </div>
      <input
        id="model-offline-pack"
        ref={inputRef}
        type="text"
        value={packDir}
        placeholder="/path/to/model-pack"
        onChange={(event) => {
          setPackDir(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void runImport();
          }
        }}
      />
      <button
        type="button"
        className="button"
        disabled={packDir.trim() === "" || busy}
        onClick={() => void runImport()}
      >
        <FolderOpen aria-hidden="true" size={14} />
        {busy ? "Importing…" : "Import"}
      </button>
      {imported !== null && imported.length > 0 && (
        <p className="lst-ok-text">Installed: {imported.join(", ")}</p>
      )}
      {imported !== null && imported.length === 0 && (
        <p className="lst-error-text">Nothing was imported.</p>
      )}
    </div>
  );
}

export function ModelsPanel({ models }: { models: ModelUiState }) {
  const [action, setAction] = useState<DialogAction>(null);
  const [instantiating, setInstantiating] = useState<string | null>(null);
  const t = useT();

  const runInstall = async (id: string) => {
    setInstantiating(id);
    await models.startInstall(id);
    setInstantiating(null);
    setAction(null);
  };

  const runDelete = async (id: string) => {
    await models.remove(id);
    setAction(null);
  };

  const cards = (list: ModelInfo[]): ReactNode =>
    list.length === 0 ? (
      <p className="lst-model-empty">
        {list === models.installed
          ? t("modelsNoInstalled")
          : t("modelsNoAvailable")}
      </p>
    ) : (
      <div className="lst-model-grid">
        {list.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            progress={models.progress[model.id] ?? null}
            inUse={models.list.inUse.includes(model.id)}
            instantiating={instantiating === model.id}
            onInstallClick={(clicked) => {
              setAction({ kind: "install", model: clicked });
            }}
            onDeleteClick={(clicked) => {
              setAction({ kind: "delete", model: clicked });
            }}
          />
        ))}
      </div>
    );

  return (
    <section className="glass-panel" aria-label="Models">
      <div className="card-head">
        <div className="card-title">
          <Database aria-hidden="true" size={17} />
          <h2>Models</h2>
        </div>
        <span className="pill on" aria-live="polite">
          <span aria-hidden="true" />
          {models.installed.length} installed · {models.available.length} available
        </span>
      </div>
      <p className="lst-page-description">
        Model files are downloaded only when you choose them, from the pinned
        official sources referenced in the confirmation dialogs. Nothing is
        fetched at install time. Installed models are verified by checksum on
        disk.
      </p>
      <DownloadServerRow models={models} />
      <OfflinePackRow models={models} />
      {models.error !== null && (
        <p className="lst-error-text">{models.error}</p>
      )}
      <section className="lst-model-section" aria-label={t("modelsInstalled")}>
        <h3 className="section-heading">{t("modelsInstalled")}</h3>
        {cards(models.installed)}
      </section>
      <section className="lst-model-section" aria-label={t("modelsAvailable")}>
        <h3 className="section-heading">{t("modelsAvailable")}</h3>
        {cards(models.available)}
      </section>
      {(models.knownInstalled.length > 0 ||
        models.knownAvailable.length > 0) && (
        <section
          className="lst-model-section"
          aria-label={t("modelsLocalExports")}
        >
          <h3 className="section-heading">{t("modelsLocalExports")}</h3>
          <p className="lst-page-description">
            Fixed-language CTC models generated on this PC via
            <code> scripts/export_ncspeech_onnx.py</code>. They are not
            downloaded through the catalog.
          </p>
          <div className="lst-model-grid">
            {[...models.knownInstalled, ...models.knownAvailable].map(
              (model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  progress={models.progress[model.id] ?? null}
                  inUse={models.list.inUse.includes(model.id)}
                  instantiating={instantiating === model.id}
                  localOnly
                  onInstallClick={() => undefined}
                  onDeleteClick={() => undefined}
                />
              ),
            )}
          </div>
        </section>
      )}
      {action !== null && (
        <ConfirmModelDialog
          action={action}
          inUse={models.list.inUse.includes(action.model.id)}
          error={models.error}
          onInstall={(id) => void runInstall(id)}
          onDelete={(id) => void runDelete(id)}
          onClose={() => {
            if (!instantiating) {
              setAction(null);
            }
          }}
        />
      )}
    </section>
  );
}
