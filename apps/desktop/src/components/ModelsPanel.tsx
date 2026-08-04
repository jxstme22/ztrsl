import {
  Database,
  FolderOpen,
  HardDriveDownload,
  Trash2,
  X,
  Cpu,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useT } from "../features/i18n/store";

import type { ModelInfo, ModelProgress } from "../models/model";
import type { ModelUiState } from "../models/useModels";
import type { GpuRuntimeUiState } from "../models/useGpuRuntime";
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

function kindLabel(kind: string, t: ReturnType<typeof useT>): string {
  return kind === "asr"
    ? t("modelsSpeechRecognitionLabel")
    : t("modelsTranslationLabel");
}

/** Honest capability labels (Phase 9, ADR-016): never overclaim a decoder
 * lock. `forced` means a fixed-language CTC model; `preferred`/`post-filter`
 * mean the decoder is multilingual and the language gate does the filtering. */
function capabilityLabel(
  languageCapability: string,
  t: ReturnType<typeof useT>,
): string {
  switch (languageCapability) {
    case "forced":
      return t("modelsCapabilityForced");
    case "preferred":
      return t("modelsCapabilityPreferred");
    default:
      return t("modelsCapabilityPostFilter");
  }
}

function vramLabel(vramClass: string, t: ReturnType<typeof useT>): string {
  switch (vramClass) {
    case "low":
      return t("modelsVramLow");
    case "medium":
      return t("modelsVramMedium");
    case "high":
      return t("modelsVramHigh");
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
  const t = useT();
  const label =
    event.phase === "download"
      ? t("liveModelsDownloading")
      : event.phase === "extract"
        ? t("liveModelsExtracting")
        : t("liveModelsInstalling");
  const { speed, eta } = useDownloadSpeed(
    `${event.modelId}:${String(event.fileIndex)}`,
    event.totalBytesDone,
    event.totalBytesTotal,
  );
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
        {event.phase === "download" && speed !== null && speed > 0 && (
          <>
            {" · "}
            {formatBytes(speed)}/s
            {eta !== null && <> · {formatEta(eta)} left</>}
          </>
        )}
      </span>
    </div>
  );
}

/** Format a duration in seconds as a compact ETA ("1m 30s", "12s"). */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total >= 60) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest > 0
      ? `${String(minutes)}m ${String(rest)}s`
      : `${String(minutes)}m`;
  }
  return `${String(total)}s`;
}

/**
 * Rolling download speed + ETA. Feed it the current bytes-done (and the total)
 * on every progress event with a stable `key` so the history resets when a
 * new download/file begins. Returns `{ speed, eta }` where both are `null`
 * until enough samples exist.
 */
export function useDownloadSpeed(
  key: string,
  bytesDone: number,
  totalBytes: number,
): { speed: number | null; eta: number | null } {
  const historyRef = useRef<{ key: string; at: number; bytes: number }[]>([]);
  const [speed, setSpeed] = useState<number | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    const points = historyRef.current;
    if (points[0]?.key !== key) {
      historyRef.current = [{ key, at: now, bytes: bytesDone }];
      setSpeed(null);
      setEta(null);
      return;
    }
    points.push({ key, at: now, bytes: bytesDone });
    while (points.length > 1 && now - points[0].at > 4000) {
      points.shift();
    }
    const first = points.at(0);
    const last = points.at(-1);
    if (first === undefined || last === undefined || first === last) {
      return;
    }
    const elapsedSec = (last.at - first.at) / 1000;
    if (elapsedSec > 0.5 && last.bytes > first.bytes) {
      const current = (last.bytes - first.bytes) / elapsedSec;
      setSpeed(current);
      setEta(
        current > 0 && totalBytes > 0
          ? Math.max(0, (totalBytes - last.bytes) / current)
          : null,
      );
    }
    return () => {
      historyRef.current = [];
    };
  }, [key, bytesDone, totalBytes]);
  return { speed, eta };
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
  t,
}: {
  action: Exclude<DialogAction, null>;
  inUse: boolean;
  error: string | null;
  onInstall: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useT>;
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
        aria-label={
          isDelete
            ? t("modelsDialogDeleteTitle")
            : t("modelsDialogInstallTitle")
        }
        className="lst-modal"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="lst-modal-head">
          <h3>
            {isDelete
              ? `${t("modelsDialogDeleteTitle")} ${model.name}?`
              : `${t("modelsDialogInstallTitle")} ${model.name}?`}
          </h3>
          <button
            type="button"
            className="button quiet"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        {isDelete ? (
          <p className="lst-modal-body">
            {t("modelsDialogDeleteBody")
              .replace("{model}", model.name)
              .replace("{size}", formatBytes(model.installedSizeBytes))
              .replace("{inUse}", inUse ? t("modelsDialogInUseNotice") : "")}
          </p>
        ) : (
          <>
            <p className="lst-modal-body">{model.description}</p>
            <dl className="lst-modal-details">
              <div>
                <dt>{t("modelsDialogType")}</dt>
                <dd>{kindLabel(model.kind, t)}</dd>
              </div>
              <div>
                <dt>{t("modelsDialogDownloadSize")}</dt>
                <dd>{formatBytes(model.downloadSizeBytes)}</dd>
              </div>
              <div>
                <dt>{t("modelsDialogLicense")}</dt>
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
                <dt>{t("modelsDialogSource")}</dt>
                <dd className="lst-modal-url">{model.source}</dd>
              </div>
              <div>
                <dt>{t("modelsDialogFiles")}</dt>
                <dd>
                  {model.fileCount} artifact{model.fileCount === 1 ? "" : "s"} ·{" "}
                  {t("modelsDialogFileArtifacts")}
                </dd>
              </div>
            </dl>
          </>
        )}
        {error !== null && <p className="lst-error-text">{error}</p>}
        <div className="lst-modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {t("cancel")}
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
              {t("modelsDeleteAction")}
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
              {t("modelsDialogDownloadInstall")}
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
  onRevealClick,
  t,
}: {
  model: ModelInfo;
  progress: ModelProgress | null;
  inUse: boolean;
  instantiating: boolean;
  /** v0.4: a locally-exported model (NCSpeech) — no download button. */
  localOnly?: boolean;
  onInstallClick: (model: ModelInfo) => void;
  onDeleteClick: (model: ModelInfo) => void;
  onRevealClick: (model: ModelInfo) => void;
  t: ReturnType<typeof useT>;
}) {
  const installing = progress !== null && !progress.done;
  const installed = model.status === "installed";
  const finishedError =
    progress !== null && progress.done && progress.error !== null;
  return (
    <article className="lst-model-card" data-installed={installed || undefined}>
      <div className="lst-model-card-head">
        <h3>{model.name}</h3>
        {installed && (
          <span
            className="lst-model-status-dot"
            aria-label={t("modelsInstalled")}
          >
            <span aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="lst-model-description">{model.description}</p>
      <div className="lst-model-meta">
        <span>{kindLabel(model.kind, t)}</span>
        <span>·</span>
        <span>
          {installed
            ? `${formatBytes(model.installedSizeBytes)} ${t("modelsOnDiskMeta")}`
            : `${formatBytes(model.downloadSizeBytes)} ${t("modelsDownloadMeta")}`}
        </span>
        <span>·</span>
        <span>{model.licenseSpdx}</span>
        {model.recommended && (
          <span className="lst-chip">{t("modelsRecommended")}</span>
        )}
        {localOnly && (
          <span className="lst-chip lst-chip-local">
            {t("modelsLocalExportBadge")}
          </span>
        )}
        {model.licenseSpdx === "CC-BY-NC-4.0" && (
          <span className="lst-chip lst-chip-warn">
            {t("modelsNonCommercial")}
          </span>
        )}
        <span className="lst-capability">
          {capabilityLabel(model.capabilities.languageCapability, t)}
        </span>
        <span className="lst-capability">
          {vramLabel(model.capabilities.vramClass, t)}
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
          <>
            {model.modelDir !== "" && (
              <button
                type="button"
                className="button secondary"
                disabled={inUse || installing}
                onClick={() => {
                  onRevealClick(model);
                }}
              >
                <FolderOpen aria-hidden="true" size={14} />
                {t("modelsBrowse")}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={inUse || installing}
              title={inUse ? t("modelsInUseTitle") : undefined}
              onClick={() => {
                onDeleteClick(model);
              }}
            >
              <Trash2 aria-hidden="true" size={14} />
              {t("modelsDeleteAction")}
            </button>
          </>
        ) : installing ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              onInstallClick(model);
            }}
            aria-label={`${t("modelsCancelInstall")} ${model.name}`}
          >
            {t("modelsCancelInstall")}
          </button>
        ) : localOnly ? (
          <span className="lst-model-local-hint">
            {t("modelsLocalExportHint")}
          </span>
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
            {t("modelsInstallAction2")}
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
  const t = useT();
  const currentLabel = mirrorInUse
    ? `hf-mirror.com`
    : userPicked
      ? downloadEndpoint.endpoint
      : "Hugging Face";
  return (
    <div className="card lst-settings-card">
      <div className="card-head">
        <h3 className="card-title">{t("modelsDownloadServerLabel")}</h3>
        <span className="lst-chip lst-chip-active">{currentLabel}</span>
      </div>
      <div className="live-grid">
        <div className="field span-2">
          <Select
            id="model-download-server"
            label={t("modelsDownloadServer")}
            value={userPicked ? downloadEndpoint.endpoint : ""}
            onChange={(endpoint) => {
              void models.setDownloadEndpoint(endpoint);
            }}
            options={[
              { value: "", label: t("modelsAutomatic") },
              {
                value: "https://hf-mirror.com",
                label: "hf-mirror.com (mainland China)",
              },
            ]}
          />
          <small className="field-note">
            {mirrorInUse
              ? "Downloads go through the selected mirror."
              : userPicked
                ? "Downloads go through Hugging Face directly."
                : "Downloads go through Hugging Face directly. Set HF_ENDPOINT or LST_HF_ENDPOINT to use a mirror."}
          </small>
        </div>
        {providerStatus.providers.length > 0 && (
          <p className="lst-provider-order span-2">
            Provider order:{" "}
            {providerStatus.providers
              .map((provider) =>
                provider.custom ? provider.host : provider.name,
              )
              .join(" → ")}
          </p>
        )}
      </div>
    </div>
  );
}

function OfflinePackRow({ models }: { models: ModelUiState }) {
  const [packDir, setPackDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

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

  const browse = async () => {
    const picked = await models.pickFolder();
    if (picked !== null) {
      setPackDir(picked);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="card lst-settings-card">
      <div className="card-head">
        <h3 className="card-title">{t("modelsOfflinePackLabel")}</h3>
      </div>
      <div className="live-grid">
        <div className="field span-2">
          <label htmlFor="model-offline-pack">
            {t("modelsOfflinePackLabel")}
          </label>
          <div className="lst-pack-dir-row">
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
              className="button secondary"
              disabled={busy}
              onClick={() => void browse()}
            >
              <FolderOpen aria-hidden="true" size={14} />
              {t("modelsOfflinePackBrowse")}
            </button>
          </div>
          <small className="field-note">{t("modelsOfflinePackNote")}</small>
        </div>
        {imported !== null && imported.length > 0 && (
          <p className="lst-ok-text span-2">
            {t("modelsInstalledSuffix")}: {imported.join(", ")}
          </p>
        )}
        {imported !== null && imported.length === 0 && (
          <p className="lst-error-text span-2">{t("modelsNothingImported")}</p>
        )}
        <div className="span-2 lst-import-actions">
          <button
            type="button"
            className="button"
            disabled={packDir.trim() === "" || busy}
            onClick={() => void runImport()}
          >
            <FolderOpen aria-hidden="true" size={14} />
            {busy ? t("modelsImporting") : t("modelsImportBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function UrlInstallRow({ models }: { models: ModelUiState }) {
  const [modelId, setModelId] = useState<string>("");
  const [kind, setKind] = useState("asr");
  const [runtime, setRuntime] = useState("faster-whisper");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useT();

  const runInstall = async () => {
    if (url.trim() === "" || busy) {
      return;
    }
    setBusy(true);
    try {
      await models.installFromUrl(modelId, url.trim(), kind, runtime);
      setUrl("");
      if (modelId !== "") {
        setModelId("");
      }
    } catch {
      // error is surfaced through models.error
    } finally {
      setBusy(false);
    }
  };

  const known = [...models.knownAvailable, ...models.knownInstalled];
  const kindOptions = [
    { value: "asr", label: "Speech recognition (ASR)" },
    { value: "translation", label: "Translation (MT)" },
  ];
  const runtimeOptions = [
    { value: "faster-whisper", label: "faster-whisper (Whisper)" },
    { value: "ctranslate2", label: "ctranslate2 (NLLB)" },
    { value: "sherpa-onnx", label: "sherpa-onnx (CTC)" },
    { value: "candle", label: "candle (MADLAD)" },
  ];

  return (
    <div className="card lst-settings-card">
      <div className="card-head">
        <h3 className="card-title">{t("modelsUrlInstallLabel")}</h3>
      </div>
      <div className="live-grid">
        <div className="field">
          <label htmlFor="model-url-id">{t("modelsUrlInstallModel")}</label>
          <input
            id="model-url-id"
            type="text"
            value={modelId}
            placeholder={
              known[0] !== undefined
                ? `${known[0].id} — or a custom id`
                : "custom id (lowercase, digits, dashes)"
            }
            onChange={(event) => {
              setModelId(event.currentTarget.value.trim());
            }}
          />
          <small className="field-note">{t("modelsUrlInstallIdHint")}</small>
        </div>
        <div className="field">
          <label htmlFor="model-url">{t("modelsUrlInstallUrl")}</label>
          <input
            id="model-url"
            type="url"
            value={url}
            placeholder="https://host/path/model-pack.zip"
            onChange={(event) => {
              setUrl(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runInstall();
              }
            }}
          />
          <small className="field-note">{t("modelsUrlInstallNote")}</small>
        </div>
        <div className="field">
          <label htmlFor="model-url-kind">{t("modelsUrlInstallKind")}</label>
          <Select
            id="model-url-kind"
            label={t("modelsUrlInstallKind")}
            value={kind}
            options={kindOptions}
            onChange={(value) => {
              setKind(value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="model-url-runtime">{t("modelsUrlInstallRuntime")}</label>
          <Select
            id="model-url-runtime"
            label={t("modelsUrlInstallRuntime")}
            value={runtime}
            options={runtimeOptions}
            onChange={(value) => {
              setRuntime(value);
            }}
          />
        </div>
        <div className="span-2 lst-import-actions">
          <button
            type="button"
            className="button"
            disabled={url.trim() === "" || busy}
            onClick={() => void runInstall()}
          >
            {busy ? t("modelsImporting") : t("modelsUrlInstallBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function GpuRuntimePanel({
  gpuRuntime,
  t,
}: {
  gpuRuntime: GpuRuntimeUiState;
  t: ReturnType<typeof useT>;
}) {
  const { status, progress, error, install, cancel, remove, isInstalling } =
    gpuRuntime;
  const installed = status.installed;
  const pct =
    progress !== null && progress.totalBytesTotal > 0
      ? Math.min(
          100,
          Math.round(
            (progress.totalBytesDone / progress.totalBytesTotal) * 100,
          ),
        )
      : 0;
  const { speed, eta } = useDownloadSpeed(
    "gpu-runtime",
    progress?.totalBytesDone ?? 0,
    progress?.totalBytesTotal ?? 0,
  );
  return (
    <section className="card lst-gpu-card" aria-label={t("gpuTitle")}>
      <div className="card-head">
        <h3 className="card-title">
          <span className="lst-gpu-icon">
            <Cpu aria-hidden="true" size={15} />
          </span>
          {t("gpuTitle")}
        </h3>
        {installed ? (
          <span className="lst-badge lst-badge-installed">
            {t("gpuInstalled")}
          </span>
        ) : !isInstalling && status.systemAvailable ? (
          <span className="lst-badge lst-badge-installed">
            {t("gpuSystemAvailable")}
          </span>
        ) : (
          <span className="lst-badge lst-badge-warn">
            {t("gpuNotInstalled")}
          </span>
        )}
      </div>
      <p className="lst-gpu-desc">{t("gpuDescription")}</p>

      {!installed && !isInstalling && !status.systemAvailable && (
        <div className="lst-gpu-meta">
          <span>
            {t("gpuDownloadSize")}: {formatBytes(status.downloadSizeBytes)}
          </span>
          {status.wheels.length > 0 && (
            <span>
              {status.wheels.map((wheel) => wheel.package).join(" · ")}
            </span>
          )}
        </div>
      )}

      {!installed && status.systemAvailable && !isInstalling && (
        <p className="lst-gpu-system-note">{t("gpuSystemAvailableNote")}</p>
      )}

      {isInstalling && progress !== null && (
        <div className="lst-gpu-progress">
          <div className="lst-progress">
            <div className="lst-progress-track">
              <div
                className="lst-progress-fill"
                style={{ width: `${String(pct)}%` }}
              />
            </div>
            <span className="lst-progress-meta">
              {progress.fileCount > 0
                ? `${t("gpuDownloading")} ${String(progress.fileIndex + 1)} of ${String(progress.fileCount)} · ${formatBytes(progress.totalBytesDone)} / ${formatBytes(progress.totalBytesTotal)}`
                : `${t("gpuDownloading")} · ${formatBytes(progress.totalBytesDone)}`}
              {speed !== null && speed > 0 && (
                <>
                  {" · "}
                  {formatBytes(speed)}/s
                  {eta !== null && <> · {formatEta(eta)} left</>}
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {error !== null && <p className="lst-error-text">{error}</p>}

      <div className="lst-gpu-actions">
        {installed ? (
          <>
            {status.path !== "" && (
              <button
                type="button"
                className="button secondary"
                onClick={() => void gpuRuntime.revealPath()}
              >
                <FolderOpen aria-hidden="true" size={14} />
                {t("modelsBrowse")}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => void remove()}
            >
              <Trash2 aria-hidden="true" size={14} />
              {t("gpuRemove")}
            </button>
          </>
        ) : isInstalling ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => void cancel()}
          >
            {t("cancel")}
          </button>
        ) : status.hasArtifacts ? (
          <>
            {status.path !== "" && (
              <button
                type="button"
                className="button secondary"
                onClick={() => void gpuRuntime.revealPath()}
              >
                <FolderOpen aria-hidden="true" size={14} />
                {t("modelsBrowse")}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => void remove()}
            >
              <Trash2 aria-hidden="true" size={14} />
              {t("gpuRemovePartial")}
            </button>
            {!status.systemAvailable && (
              <button
                type="button"
                className="button primary"
                onClick={() => void install()}
              >
                <HardDriveDownload aria-hidden="true" size={14} />
                {t("gpuInstall")}
              </button>
            )}
          </>
        ) : status.systemAvailable ? (
          <span className="lst-model-local-hint">{t("gpuReady")}</span>
        ) : (
          <button
            type="button"
            className="button primary"
            onClick={() => void install()}
          >
            <HardDriveDownload aria-hidden="true" size={14} />
            {t("gpuInstall")}
          </button>
        )}
      </div>
    </section>
  );
}

export function ModelsPanel({
  models,
  gpuRuntime,
}: {
  models: ModelUiState;
  gpuRuntime: GpuRuntimeUiState;
}) {
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
            onRevealClick={(clicked) => {
              void models.revealPath(clicked.modelDir);
            }}
            t={t}
          />
        ))}
      </div>
    );

  return (
    <>
      <section
        className="card lst-models-header"
        aria-label={t("modelsPageTitle")}
      >
        <div className="card-head">
          <div className="card-title">
            <Database aria-hidden="true" size={18} />
            <h2>{t("modelsPageTitle")}</h2>
          </div>
          <span className="lst-model-count pill" aria-live="polite">
            {models.installed.length} {t("modelsInstalledCount")} ·{" "}
            {models.available.length} {t("modelsAvailableCount")}
          </span>
        </div>
        <p className="lst-page-description">{t("modelsPageDescription")}</p>
        {models.error !== null && (
          <p className="lst-error-text">{models.error}</p>
        )}
      </section>
      <DownloadServerRow models={models} />
      <UrlInstallRow models={models} />
      <OfflinePackRow models={models} />
      <GpuRuntimePanel gpuRuntime={gpuRuntime} t={t} />
      {models.custom.length > 0 && (
        <section
          className="card lst-section-card"
          aria-label={t("modelsCustom")}
        >
          <div className="card-head">
            <h3 className="card-title">{t("modelsCustom")}</h3>
            <span className="lst-model-count pill">{models.custom.length}</span>
          </div>
          <p className="lst-page-description">{t("modelsCustomDescription")}</p>
          <div className="lst-model-grid">
            {models.custom.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                progress={models.progress[model.id] ?? null}
                inUse={models.list.inUse.includes(model.id)}
                instantiating={instantiating === model.id}
                localOnly
                onInstallClick={() => undefined}
                onDeleteClick={(clicked) => {
                  setAction({ kind: "delete", model: clicked });
                }}
                onRevealClick={(clicked) => {
                  void models.revealPath(clicked.modelDir);
                }}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
      <section
        className="card lst-section-card"
        aria-label={t("modelsInstalled")}
      >
        <div className="card-head">
          <h3 className="card-title">{t("modelsInstalled")}</h3>
          <span className="lst-model-count pill">
            {models.installed.length}
          </span>
        </div>
        {cards(models.installed)}
      </section>
      <section
        className="card lst-section-card"
        aria-label={t("modelsAvailable")}
      >
        <div className="card-head">
          <h3 className="card-title">{t("modelsAvailable")}</h3>
          <span className="lst-model-count pill">
            {models.available.length}
          </span>
        </div>
        {cards(models.available)}
      </section>
      {(models.knownInstalled.length > 0 ||
        models.knownAvailable.length > 0) && (
        <section
          className="card lst-section-card"
          aria-label={t("modelsLocalExports")}
        >
          <div className="card-head">
            <h3 className="card-title">{t("modelsLocalExports")}</h3>
            <span className="lst-model-count pill">
              {models.knownInstalled.length + models.knownAvailable.length}
            </span>
          </div>
          <p className="lst-page-description">
            {t("modelsLocalExportsDescription")}
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
                  onRevealClick={(clicked) => {
                    void models.revealPath(clicked.modelDir);
                  }}
                  t={t}
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
          t={t}
        />
      )}
    </>
  );
}
