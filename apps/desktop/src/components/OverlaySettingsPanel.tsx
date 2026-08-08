import { Move } from "lucide-react";

import { useT } from "../features/i18n/store";
import type { OverlaySettings, OverlaySnapshot } from "../overlay/model";
import { loadSourceConfigs } from "../sources/storage";
import { Select } from "./Select";

export type OverlaySettingsPanelProps = {
  snapshot: OverlaySnapshot;
  onUpdateSettings: (patch: Partial<OverlaySettings>) => void;
  onSetTranslationEnabled: (enabled: boolean) => void;
  onToggleEditMode: () => void;
  onResetPlacement: () => void;
};

/** Overlay appearance controls: moved from Settings to the Live page and
 * revealed behind the "Customize overlay" button. */
export function OverlaySettingsPanel({
  snapshot,
  onUpdateSettings,
  onSetTranslationEnabled,
  onToggleEditMode,
  onResetPlacement,
}: OverlaySettingsPanelProps) {
  const t = useT();
  const sources = loadSourceConfigs().sources;

  return (
    <section className="card" aria-labelledby="overlay-appearance">
      <div className="card-head">
        <h2 className="card-title" id="overlay-appearance">
          {t("settingsOverlayAppearance")}
        </h2>
      </div>

      <div className="settings-block">
        <button className="button" type="button" onClick={onToggleEditMode}>
          <Move aria-hidden="true" size={14} />
          {snapshot.mode === "edit"
            ? t("overlayDoneMoving")
            : t("overlayMoveOverlay")}
        </button>
        <p className="field-note">{t("overlayMoveOverlayNote")}</p>

        <div className="toggles-row">
          <div className="toggle-row">
            <div>
              <label htmlFor="translation-enabled">
                {t("settingsTranslationPreview")}
              </label>
              <p>{t("settingsTranslationPreviewText")}</p>
            </div>
            <input
              id="translation-enabled"
              className="switch"
              type="checkbox"
              checked={snapshot.translationEnabled}
              onChange={(event) => {
                onSetTranslationEnabled(event.currentTarget.checked);
              }}
            />
          </div>
          <div className="toggle-row">
            <div>
              <label htmlFor="show-source">{t("settingsShowSource")}</label>
              <p>{t("settingsShowSourceText")}</p>
            </div>
            <input
              id="show-source"
              className="switch"
              type="checkbox"
              checked={snapshot.settings.showSource}
              onChange={(event) => {
                onUpdateSettings({
                  showSource: event.currentTarget.checked,
                });
              }}
            />
          </div>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>{t("settingsSimultaneous")}</span>
            <Select
              id="simultaneous-policy"
              label={t("settingsSimultaneous")}
              value={snapshot.settings.simultaneousPolicy}
              onChange={(value) => {
                onUpdateSettings({
                  simultaneousPolicy:
                    value as OverlaySettings["simultaneousPolicy"],
                });
              }}
              options={[
                { value: "show-both", label: t("settingsShowBoth") },
                { value: "newest-wins", label: t("settingsNewestWins") },
                { value: "primary-wins", label: t("settingsPrimaryWins") },
              ]}
            />
            <small className="field-note">
              {t("settingsSimultaneousNote")}
            </small>
          </label>

          <label className="field">
            <span>{t("settingsOverlayContent")}</span>
            <Select
              id="overlay-content"
              label={t("settingsOverlayContent")}
              value={snapshot.settings.overlayContent}
              onChange={(value) => {
                onUpdateSettings({
                  overlayContent: value as OverlaySettings["overlayContent"],
                });
              }}
              options={[
                { value: "captions", label: t("settingsOverlayCaptions") },
                { value: "history", label: t("settingsOverlayHistory") },
              ]}
            />
            <small className="field-note">
              {t("settingsOverlayContentNote")}
            </small>
          </label>

          <label className="field">
            <span>{t("settingsHistoryRows")}</span>
            <Select
              id="history-rows"
              label={t("settingsHistoryRows")}
              value={String(snapshot.settings.historyMaxRows)}
              onChange={(value) => {
                onUpdateSettings({
                  historyMaxRows:
                    value === "auto" ? "auto" : value === "10" ? 10 : 5,
                });
              }}
              options={[
                { value: "auto", label: t("settingsHistoryRowsDefault") },
                { value: "10", label: t("settingsHistoryRows10") },
                { value: "5", label: t("settingsHistoryRows5") },
              ]}
            />
            <small className="field-note">{t("settingsHistoryRowsNote")}</small>
          </label>

          <label className="field">
            <span>{t("settingsCaptionAlignment")}</span>
            <Select
              id="caption-alignment"
              label={t("settingsCaptionAlignment")}
              value={snapshot.settings.captionAlignment}
              onChange={(value) => {
                onUpdateSettings({
                  captionAlignment:
                    value as OverlaySettings["captionAlignment"],
                });
              }}
              options={[
                { value: "left", label: t("settingsAlignLeft") },
                { value: "center", label: t("settingsAlignCenter") },
                { value: "right", label: t("settingsAlignRight") },
              ]}
            />
            <small className="field-note">
              {t("settingsCaptionAlignmentNote")}
            </small>
          </label>

          <label className="field">
            <span>{t("settingsPrimarySource")}</span>
            <Select
              id="primary-source"
              label={t("settingsPrimarySource")}
              value={snapshot.settings.primarySourceId ?? ""}
              onChange={(value) => {
                onUpdateSettings({
                  primarySourceId: value === "" ? null : value,
                });
              }}
              options={[
                { value: "", label: t("settingsAutoPrimary") },
                ...sources.map((source) => ({
                  value: source.sourceId,
                  label: source.displayName,
                })),
              ]}
            />
            <small className="field-note">
              {t("settingsPrimarySourceNote")}
            </small>
          </label>
        </div>

        {sources.length > 1 && (
          <div className="settings-block">
            <h3>{t("settingsHiddenSources")}</h3>
            {sources.map((source) => (
              <div className="toggle-row" key={source.sourceId}>
                <div>
                  <label htmlFor={`hide-${source.sourceId}`}>
                    {t("settingsHideSource")} {source.displayName}
                  </label>
                  <p>{t("settingsHiddenSourcesNote")}</p>
                </div>
                <input
                  id={`hide-${source.sourceId}`}
                  className="switch"
                  type="checkbox"
                  checked={snapshot.settings.hiddenSourceIds.includes(
                    source.sourceId,
                  )}
                  onChange={(event) => {
                    const current = snapshot.settings.hiddenSourceIds;
                    onUpdateSettings({
                      hiddenSourceIds: event.currentTarget.checked
                        ? [...current, source.sourceId]
                        : current.filter((id) => id !== source.sourceId),
                    });
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="sliders-grid">
          <div className="range-field">
            <div className="range-label">
              <label htmlFor="overlay-width">{t("settingsWidth")}</label>
              <output htmlFor="overlay-width">
                {Math.round(snapshot.settings.widthNormalized * 100)}%
              </output>
            </div>
            <input
              id="overlay-width"
              type="range"
              min="0.3"
              max="0.95"
              step="0.01"
              value={snapshot.settings.widthNormalized}
              onChange={(event) => {
                onUpdateSettings({
                  widthNormalized: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="range-field">
            <div className="range-label">
              <label htmlFor="overlay-height">{t("settingsHeight")}</label>
              <output htmlFor="overlay-height">
                {Math.round(snapshot.settings.heightNormalized * 100)}%
              </output>
            </div>
            <input
              id="overlay-height"
              type="range"
              min="0.05"
              max="0.9"
              step="0.01"
              value={snapshot.settings.heightNormalized}
              onChange={(event) => {
                onUpdateSettings({
                  heightNormalized: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="range-field">
            <div className="range-label">
              <label htmlFor="font-scale">{t("settingsTextSize")}</label>
              <output htmlFor="font-scale">
                {Math.round(snapshot.settings.fontScale * 100)}%
              </output>
            </div>
            <input
              id="font-scale"
              type="range"
              min="0.8"
              max="1.6"
              step="0.1"
              value={snapshot.settings.fontScale}
              onChange={(event) => {
                onUpdateSettings({
                  fontScale: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="range-field">
            <div className="range-label">
              <label htmlFor="background-opacity">
                {t("settingsBackground")}
              </label>
              <output htmlFor="background-opacity">
                {Math.round(snapshot.settings.backgroundOpacity * 100)}%
              </output>
            </div>
            <input
              id="background-opacity"
              type="range"
              min="0.12"
              max="0.9"
              step="0.02"
              value={snapshot.settings.backgroundOpacity}
              onChange={(event) => {
                onUpdateSettings({
                  backgroundOpacity: Number(event.currentTarget.value),
                });
              }}
            />
          </div>
        </div>

        <button
          className="button quiet reset-button"
          type="button"
          onClick={onResetPlacement}
        >
          {t("settingsResetPosition")}
        </button>
      </div>
    </section>
  );
}
