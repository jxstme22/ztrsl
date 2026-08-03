import { ArrowLeft, ArrowRight, Check, Info, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAudioMeter } from "../audio/useAudioMeter";
import { Select } from "../components/Select";
import { useT } from "../features/i18n/store";
import type { UIKey } from "../features/i18n/strings";
import {
  LABEL_STYLE_OPTIONS,
  PRESET_OPTIONS,
} from "../components/SourcesPanel";
import {
  MAX_SOURCES,
  type CaptionLabelStyle,
  type LanguageProfile,
  type LanguageStrictness,
} from "../sources/model";
import { formatPreview, renderLabel } from "../sources/labels";
import { saveSourceConfigs } from "../sources/storage";
import { detectVbCable } from "./vbCable";
import {
  WIZARD_STEP_IDS,
  addSource,
  assignCaptureTarget,
  canProceed,
  currentStepId,
  goToStep,
  initialWizardState,
  markSaved,
  save,
  selectMode,
  setLanguage,
  setMonitoring,
  setMonitorEndpoint,
  setMonitorVolume,
  updateSource,
  type WizardState,
  type WizardStepId,
} from "./wizardModel";

const SAMPLE_TEAM_CAPTION = "Rotate B!";
const SAMPLE_DISCORD_CAPTION = "Let's go!";

const PROFILE_OPTIONS: readonly { value: LanguageProfile; label: string }[] = [
  { value: "tagalog", label: "Tagalog" },
  { value: "taglish", label: "Taglish" },
  { value: "cebuano", label: "Cebuano" },
  { value: "bislish", label: "Bislish" },
  { value: "mandarin", label: "Mandarin" },
  { value: "chinese_english", label: "Chinese + English" },
  { value: "auto", label: "Auto-detect" },
];

const STRICTNESS_OPTIONS: readonly {
  value: LanguageStrictness;
  labelKey: UIKey;
}[] = [
  { value: "off", labelKey: "strictnessOff" },
  { value: "balanced", labelKey: "strictnessBalanced" },
  { value: "strict", labelKey: "strictnessStrict" },
];

const VB_CABLE_NOTICE =
  "VB-CABLE is installed separately from its official source (vb-audio.com). This app never bundles it.";

const WIZARD_STEP_LABEL_KEYS: Record<WizardStepId, UIKey> = {
  "choose-setup": "wizardStepLabel_chooseSetup",
  "add-first-source": "wizardStepLabel_addFirstSource",
  "select-capture": "wizardStepLabel_selectCapture",
  "valorant-routing": "wizardStepLabel_valorantRouting",
  "add-social": "wizardStepLabel_addSocial",
  "monitoring-output": "wizardStepLabel_monitoringOutput",
  "isolation-test": "wizardStepLabel_isolationTest",
  "monitoring-test": "wizardStepLabel_monitoringTest",
  "language-strictness": "wizardStepLabel_languageStrictness",
  "overlay-preview": "wizardStepLabel_overlayPreview",
  "save-preset": "wizardStepLabel_savePreset",
};

export function SetupWizard({ onFinish }: { onFinish: () => void }) {
  const audio = useAudioMeter();
  const [state, setState] = useState<WizardState>(() =>
    initialWizardState(
      audio.catalog ?? emptyCatalog(),
      detectVbCable(emptyCatalog()),
    ),
  );

  useEffect(() => {
    const catalog = audio.catalog;
    if (catalog === null) {
      return;
    }
    setState((current) => ({ ...current, vbCable: detectVbCable(catalog) }));
  }, [audio.catalog]);

  const step = currentStepId(state);
  const gate = canProceed(state);

  const next = () => {
    if (!gate.ok) {
      return;
    }
    if (step === "save-preset") {
      const { configs, error } = save(state);
      if (error !== null) {
        return;
      }
      saveSourceConfigs(configs);
      setState(markSaved(state));
      return;
    }
    setState((current) => goToStep(current, current.stepIndex + 1));
  };

  const stepIndex = WIZARD_STEP_IDS.indexOf(step);
  const t = useT();

  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="wizard-title">
        <div className="card-head">
          <h2 className="card-title" id="wizard-title">
            {t("wizardTitle")}
          </h2>
          <span className="pill on">
            <span aria-hidden="true" />
            {t("wizardStep")} {stepIndex + 1} {t("wizardOf")}{" "}
            {WIZARD_STEP_IDS.length}
          </span>
        </div>
        <ol className="wizard-steps" aria-label="Wizard progress">
          {WIZARD_STEP_IDS.map((stepId, index) => (
            <li
              key={stepId}
              className={
                index === stepIndex
                  ? "current"
                  : index < stepIndex
                    ? "done"
                    : ""
              }
            >
              <button
                type="button"
                className="wizard-step-chip"
                disabled={index > stepIndex}
                onClick={() => {
                  setState((current) => goToStep(current, index));
                }}
              >
                {index + 1}
              </button>
              <span>{t(WIZARD_STEP_LABEL_KEYS[stepId])}</span>
            </li>
          ))}
        </ol>
      </section>

      {renderStep(state, step, audio, setState, t)}

      {state.saved ? (
        <section className="card" aria-labelledby="wizard-complete">
          <div className="card-head">
            <h3 className="card-title" id="wizard-complete">
              {t("wizardSetupSaved")}
            </h3>
            <span className="pill on">
              <span aria-hidden="true" />
              <Check aria-hidden="true" size={12} />
              {t("wizardDone")}
            </span>
          </div>
          <p className="card-note">
            {t("wizardSetupSavedNote")} Captions only start once live audio
            capture is enabled.
          </p>
          <div className="action-row">
            <button className="button primary" type="button" onClick={onFinish}>
              {t("sourcesTitle")}
            </button>
          </div>
        </section>
      ) : (
        <section className="card" aria-labelledby="wizard-nav">
          <div className="action-row wizard-nav">
            <button
              className="button quiet"
              type="button"
              disabled={stepIndex === 0}
              onClick={() => {
                setState((current) => goToStep(current, current.stepIndex - 1));
              }}
            >
              <ArrowLeft aria-hidden="true" size={14} />
              {t("wizardBack")}
            </button>
            <div className="wizard-nav-gate">
              {!gate.ok && (
                <p className="field-errors" role="alert">
                  <Info aria-hidden="true" size={13} />
                  {gate.reason}
                </p>
              )}
              <button
                className="button primary"
                type="button"
                disabled={!gate.ok}
                onClick={next}
              >
                {step === "save-preset"
                  ? t("wizardSavePreset")
                  : t("wizardNext")}
                <ArrowRight aria-hidden="true" size={14} />
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function emptyCatalog() {
  return {
    platform: "development" as const,
    endpoints: [],
    deviceChangeDetected: false,
    processCaptureSupported: false,
  };
}

function renderStep(
  state: WizardState,
  step: (typeof WIZARD_STEP_IDS)[number],
  audio: ReturnType<typeof useAudioMeter>,
  setState: React.Dispatch<React.SetStateAction<WizardState>>,
  t: ReturnType<typeof useT>,
) {
  switch (step) {
    case "choose-setup":
      return (
        <section className="card" aria-labelledby="step-choose">
          <h3 className="card-title" id="step-choose">
            {t("wizardChooseSetup")}
          </h3>
          <div className="choice-grid">
            <SetupChoice
              title={t("wizardRecommended")}
              detail={t("wizardRecommendedDetail")}
              onClick={() => {
                setState((s) => selectMode(s, "recommended"));
              }}
            />
            <SetupChoice
              title={t("wizardAdvanced")}
              detail={t("wizardAdvancedDetail")}
              onClick={() => {
                setState((s) => selectMode(s, "advanced"));
              }}
            />
          </div>
          <p className="card-note">{VB_CABLE_NOTICE}</p>
        </section>
      );
    case "add-first-source":
      return (
        <SourcePickerStep
          state={state}
          setState={setState}
          includeDiscord={state.mode === "advanced"}
        />
      );
    case "select-capture":
      return (
        <CaptureMethodStep state={state} setState={setState} audio={audio} />
      );
    case "valorant-routing":
      return <ValorantRoutingStep state={state} audio={audio} />;
    case "add-social":
      return <SocialSourceStep state={state} setState={setState} />;
    case "monitoring-output":
      return (
        <MonitoringOutputStep state={state} setState={setState} audio={audio} />
      );
    case "isolation-test":
      return <IsolationTestStep state={state} audio={audio} />;
    case "monitoring-test":
      return (
        <MonitoringTestStep state={state} setState={setState} audio={audio} />
      );
    case "language-strictness":
      return <LanguageStep state={state} setState={setState} />;
    case "overlay-preview":
      return <OverlayPreviewStep state={state} setState={setState} />;
    case "save-preset":
      return <SaveStep state={state} />;
  }
}

function SetupChoice({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="setup-choice" onClick={onClick}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  );
}

function SourceEditor({
  draftIndex,
  state,
  setState,
}: {
  draftIndex: number;
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const draft = state.sources[draftIndex];
  if (draft === undefined) {
    return null;
  }
  const { config } = draft;
  const t = useT();
  return (
    <section
      className="card"
      aria-labelledby={`wizard-source-${config.sourceId}`}
    >
      <div className="card-head">
        <h4 className="card-title" id={`wizard-source-${config.sourceId}`}>
          {config.displayName.trim() === ""
            ? t("sourcesUnnamed")
            : config.displayName}
        </h4>
        <span className="pill">
          <span aria-hidden="true" />
          {config.sourceId.slice(0, 8)}
        </span>
      </div>
      <div className="form-grid">
        <div className="field">
          <span>{t("sourcesName")}</span>
          <input
            type="text"
            value={config.displayName}
            maxLength={48}
            onChange={(event) => {
              setState((s) =>
                updateSource(s, draftIndex, {
                  displayName: event.currentTarget.value,
                }),
              );
            }}
          />
        </div>
        <div className="field">
          <span>{t("sourcesCaptionTag")}</span>
          <input
            type="text"
            value={config.captionTag}
            maxLength={32}
            placeholder="TEAM"
            onChange={(event) => {
              setState((s) =>
                updateSource(s, draftIndex, {
                  captionTag: event.currentTarget.value,
                }),
              );
            }}
          />
        </div>
        <div className="field">
          <span>{t("wizardCaptionStyle")}</span>
          <Select
            label={t("wizardCaptionStyle")}
            value={config.labelStyle}
            onChange={(value) => {
              setState((s) =>
                updateSource(s, draftIndex, {
                  labelStyle: value as CaptionLabelStyle,
                }),
              );
            }}
            options={LABEL_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>
      </div>
      <div
        className="preview-stage source-preview"
        aria-label="Caption preview"
      >
        <p className="caption-english">
          {renderLabel(config.captionTag, config.labelStyle).label !== null && (
            <span className="caption-inline-label">
              {renderLabel(config.captionTag, config.labelStyle).label}{" "}
            </span>
          )}
          Rotate B!
        </p>
      </div>
    </section>
  );
}

function SourcePickerStep({
  state,
  setState,
  includeDiscord,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  includeDiscord: boolean;
}) {
  const [presetId, setPresetId] = useState("valorant-team");
  const atMax = state.sources.length >= MAX_SOURCES;
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-add-first">
        <h3 className="card-title" id="step-add-first">
          {t("wizardAddFirstSource")}
        </h3>
        <p className="card-note">{t("wizardAddFirstSourceNote")}</p>
        <div className="action-row">
          <Select
            label={t("wizardPreset")}
            value={presetId}
            onChange={setPresetId}
            options={PRESET_OPTIONS.filter(
              (option) => !(!includeDiscord && option.value === "discord"),
            )}
          />
          <button
            className="button primary"
            type="button"
            disabled={atMax}
            onClick={() => {
              setState((s) => addSource(s, presetId as never));
            }}
          >
            {t("wizardAddSource")}
          </button>
        </div>
      </section>
      {state.sources.map((draft, index) => (
        <SourceEditor
          key={draft.config.sourceId}
          draftIndex={index}
          state={state}
          setState={setState}
        />
      ))}
    </>
  );
}

function CaptureMethodStep({
  state,
  setState,
  audio,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  audio: ReturnType<typeof useAudioMeter>;
}) {
  const options = useMemo(
    () =>
      audio.captureEndpoints.map((endpoint) => ({
        value: endpoint.id,
        label: endpoint.friendlyName,
        group: endpoint.isSynthetic ? "Simulator" : "Audio endpoints",
      })),
    [audio.captureEndpoints],
  );
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-capture">
        <h3 className="card-title" id="step-capture">
          {t("wizardChooseCapture")}
        </h3>
        <p className="card-note">{t("wizardChooseCaptureNote")}</p>
        {!audio.catalog?.processCaptureSupported && (
          <p className="card-note wizard-note">
            {t("wizardProcessUnavailable")}
          </p>
        )}
      </section>
      {state.sources.map((draft, index) => {
        const { config } = draft;
        const current =
          config.captureTarget.kind === "endpoint"
            ? (config.captureTarget.endpointId ?? "")
            : "";
        return (
          <section
            className="card"
            key={config.sourceId}
            aria-label={`${t("wizardCaptureMethod")} ${config.displayName}`}
          >
            <div className="card-head">
              <h4 className="card-title">{config.displayName}</h4>
              {draft.captureResolved ? (
                <span className="pill on">
                  <span aria-hidden="true" />
                  {t("wizardSet")}
                </span>
              ) : (
                <span className="pill">{t("wizardUnset")}</span>
              )}
            </div>
            <div className="form-grid">
              <div className="field">
                <span>{t("wizardCaptureMethod")}</span>
                <Select
                  label={t("wizardCaptureMethod")}
                  value={current}
                  placeholder={t("wizardChooseEndpoint")}
                  onChange={(value) => {
                    setState((s) =>
                      assignCaptureTarget(s, index, {
                        kind: "endpoint",
                        endpointId: value === "" ? null : value,
                      }),
                    );
                  }}
                  options={options}
                />
              </div>
            </div>
            {config.captureTarget.kind === "endpoint" &&
              config.captureTarget.endpointId !== null && (
                <p className="card-note">
                  {t("wizardEndpointState")}:{" "}
                  {(() => {
                    const selectedId = config.captureTarget.endpointId;
                    return (
                      audio.catalog?.endpoints.find(
                        (endpoint) => endpoint.id === selectedId,
                      )?.state ?? "unknown"
                    );
                  })()}
                </p>
              )}
          </section>
        );
      })}
    </>
  );
}

function ValorantRoutingStep({
  state,
  audio,
}: {
  state: WizardState;
  audio: ReturnType<typeof useAudioMeter>;
}) {
  const vbCable = useMemo(
    () => detectVbCable(audio.catalog ?? emptyCatalog()),
    [audio.catalog],
  );
  const detectionIssues = useMemo(
    () => (audio.catalog === null ? state.vbCable.issues : vbCable.issues),
    [audio.catalog, state.vbCable.issues, vbCable.issues],
  );
  const t = useT();
  return (
    <section className="card" aria-labelledby="step-routing">
      <h3 className="card-title" id="step-routing">
        {t("wizardRouteValorant")}
      </h3>
      <p className="card-note">{VB_CABLE_NOTICE}</p>
      <div className="routing-guide">
        <div>
          <strong>{t("wizardGameOutput")}</strong>
          <span>{t("wizardPhysicalHeadphones")}</span>
        </div>
        <div>
          <strong>{t("wizardVoiceChatOutput")}</strong>
          <span>VB-CABLE Input</span>
        </div>
      </div>
      {detectionIssues.length > 0 ? (
        <ul className="field-warnings" role="status">
          {detectionIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="card-note wizard-note">{t("wizardVbCableDetected")}</p>
      )}
    </section>
  );
}

function SocialSourceStep({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const [presetId, setPresetId] = useState("discord");
  const atMax = state.sources.length >= MAX_SOURCES;
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-social">
        <h3 className="card-title" id="step-social">
          {t("wizardAddSocial")}
        </h3>
        <p className="card-note">{t("wizardAddSocialNote")}</p>
        <div className="action-row">
          <Select
            label={t("wizardPreset")}
            value={presetId}
            onChange={setPresetId}
            options={PRESET_OPTIONS.filter(
              (option) => option.value !== "valorant-team",
            )}
          />
          <button
            className="button primary"
            type="button"
            disabled={atMax}
            onClick={() => {
              setState((s) => addSource(s, presetId as never));
            }}
          >
            {t("wizardAddSource")}
          </button>
        </div>
        <div
          className="preview-stage source-preview"
          aria-label="Social caption preview"
        >
          <p className="caption-english">
            <span className="caption-inline-label">[DISCORD]</span> Let's go!
          </p>
        </div>
      </section>
      {state.sources
        .map((draft, index) => ({ draft, index }))
        .filter(({ draft }) => draft.presetId !== "valorant-team")
        .map(({ draft, index }) => (
          <SourceEditor
            key={draft.config.sourceId}
            draftIndex={index}
            state={state}
            setState={setState}
          />
        ))}
    </>
  );
}

function MonitoringOutputStep({
  state,
  setState,
  audio,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  audio: ReturnType<typeof useAudioMeter>;
}) {
  const outputOptions = useMemo(
    () =>
      audio.renderEndpoints.map((endpoint) => ({
        value: endpoint.id,
        label: endpoint.friendlyName,
        group: endpoint.isSynthetic ? "Simulator" : "Playback endpoints",
      })),
    [audio.renderEndpoints],
  );
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-monitor-out">
        <h3 className="card-title" id="step-monitor-out">
          {t("wizardMonitoringOutput")}
        </h3>
        <p className="card-note">{t("wizardMonitoringOutputNote")}</p>
        <div className="form-grid">
          <div className="field">
            <span>{t("wizardHeadphoneOutput")}</span>
            <Select
              label={t("wizardHeadphoneOutput")}
              value={state.monitorEndpointId ?? ""}
              placeholder={t("wizardChooseEndpoint")}
              onChange={(value) => {
                setState((s) =>
                  setMonitorEndpoint(s, value === "" ? null : value),
                );
              }}
              options={outputOptions}
            />
          </div>
        </div>
      </section>
      {state.sources.map((draft, index) => {
        const { config } = draft;
        return (
          <section
            className="card"
            key={config.sourceId}
            aria-label={`${t("wizardMonitorSource")} ${config.displayName}`}
          >
            <div className="toggle-row">
              <div>
                <label htmlFor={`monitor-${config.sourceId}`}>
                  {t("wizardMonitorSource")} {config.displayName}
                </label>
                <p>{t("wizardMonitorSourceNote")}</p>
              </div>
              <input
                id={`monitor-${config.sourceId}`}
                className="switch"
                type="checkbox"
                checked={config.monitoring.enabled}
                onChange={(event) => {
                  setState((s) =>
                    setMonitoring(s, index, {
                      enabled: event.currentTarget.checked,
                      headphoneEndpointId: event.currentTarget.checked
                        ? s.monitorEndpointId
                        : null,
                    }),
                  );
                }}
              />
            </div>
            {draft.monitorConflict && (
              <p className="field-errors" role="alert">
                {t("wizardFeedbackLoop")}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

function MeterCard({
  state,
  audio,
  instruction,
  sourceIndex,
}: {
  state: WizardState;
  audio: ReturnType<typeof useAudioMeter>;
  instruction: string;
  sourceIndex: number;
}) {
  const source = state.sources[sourceIndex];
  const captureEndpoints = audio.captureEndpoints;
  const currentTarget =
    source?.config.captureTarget.kind === "endpoint"
      ? source.config.captureTarget.endpointId
      : null;
  const options = captureEndpoints.map((endpoint) => ({
    value: endpoint.id,
    label: endpoint.friendlyName,
  }));
  const meterWidth = `${String(Math.min(100, audio.level.peak * 100))}%`;
  const meterLabel = `meter-${String(sourceIndex)}`;
  const t = useT();
  return (
    <section className="card" aria-labelledby={meterLabel}>
      <h4 className="card-title" id={meterLabel}>
        {source?.config.displayName ?? "Source"} {t("wizardLiveMeter")}
      </h4>
      <p className="card-note">{instruction}</p>
      <div className="form-grid">
        <div className="field">
          <span>{t("wizardEndpointUnderTest")}</span>
          <Select
            label={t("wizardEndpointUnderTest")}
            value={currentTarget ?? ""}
            placeholder={t("wizardChooseEndpoint")}
            onChange={(value) => {
              if (value !== "") {
                audio.selectEndpoint(value);
              }
            }}
            options={options}
          />
        </div>
      </div>
      <div className="meter-panel">
        <div className="meter-label">
          <span>{t("wizardInputLevel")}</span>
          <output>{String(Math.round(audio.level.peak * 100))}%</output>
        </div>
        <div
          className="audio-meter"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(audio.level.peak * 100)}
        >
          <span
            className={audio.level.clipped ? "clipped" : ""}
            style={{ width: meterWidth }}
          />
        </div>
        <div className="meter-meta">
          <span>{audio.active ? "metering" : "idle"}</span>
          <span>{audio.level.droppedFrames} dropped</span>
        </div>
      </div>
      <div className="action-row">
        {audio.active ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => void audio.stop()}
          >
            <Square aria-hidden="true" size={14} />
            Stop meter
          </button>
        ) : (
          <button
            className="button secondary"
            type="button"
            onClick={() => void audio.start()}
          >
            <Play aria-hidden="true" size={14} />
            Start meter
          </button>
        )}
      </div>
      {audio.error !== null && (
        <p className="field-errors" role="alert">
          {audio.error}
        </p>
      )}
    </section>
  );
}

function IsolationTestStep({
  state,
  audio,
}: {
  state: WizardState;
  audio: ReturnType<typeof useAudioMeter>;
}) {
  const teamIndex = state.sources.findIndex(
    (draft) => draft.presetId === "valorant-team",
  );
  const socialIndex = state.sources.findIndex(
    (draft) => draft.presetId !== "valorant-team",
  );
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-isolation">
        <h3 className="card-title" id="step-isolation">
          {t("wizardIsolationTest")}
        </h3>
        <p className="card-note">{t("wizardIsolationNote")}</p>
        <ul className="test-instructions">
          <li>{t("wizardIsolation1")}</li>
          <li>{t("wizardIsolation2")}</li>
          <li>{t("wizardIsolation3")}</li>
          <li>{t("wizardIsolation4")}</li>
        </ul>
      </section>
      <MeterCard
        state={state}
        audio={audio}
        sourceIndex={teamIndex === -1 ? 0 : teamIndex}
        instruction={t("wizardTeamInstruction")}
      />
      {socialIndex !== -1 && (
        <MeterCard
          state={state}
          audio={audio}
          sourceIndex={socialIndex}
          instruction={t("wizardSocialInstruction")}
        />
      )}
    </>
  );
}

function MonitoringTestStep({
  state,
  setState,
  audio,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  audio: ReturnType<typeof useAudioMeter>;
}) {
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-monitor-test">
        <h3 className="card-title" id="step-monitor-test">
          {t("wizardMonitoringTest")}
        </h3>
        <p className="card-note">{t("wizardMonitoringTestNote")}</p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`${t("wizardBlend")} ${draft.config.displayName}`}
        >
          <div className="range-field">
            <div className="range-label">
              <label htmlFor={`blend-${draft.config.sourceId}`}>
                {draft.config.displayName} {t("wizardBlend")}
              </label>
              <output htmlFor={`blend-${draft.config.sourceId}`}>
                {draft.config.monitoring.enabled
                  ? `${String(Math.round(draft.config.monitoring.volume * 100))}%`
                  : t("wizardBlendOff")}
              </output>
            </div>
            <input
              id={`blend-${draft.config.sourceId}`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.config.monitoring.volume}
              onChange={(event) => {
                setState((s) =>
                  setMonitorVolume(s, index, Number(event.currentTarget.value)),
                );
              }}
            />
          </div>
        </section>
      ))}
      <MeterCard
        state={state}
        audio={audio}
        sourceIndex={0}
        instruction={t("wizardBlendConfirm")}
      />
    </>
  );
}

function LanguageStep({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-language">
        <h3 className="card-title" id="step-language">
          {t("wizardLanguageStep")}
        </h3>
        <p className="card-note">{t("wizardLanguageNote")}</p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`${t("wizardLanguageStep")} ${draft.config.displayName}`}
        >
          <div className="form-grid">
            <div className="field">
              <span>
                {draft.config.displayName} {t("wizardProfile")}
              </span>
              <Select
                label={t("wizardProfile")}
                value={draft.config.languageProfile}
                onChange={(value) => {
                  setState((s) =>
                    setLanguage(
                      s,
                      index,
                      value as LanguageProfile,
                      s.sources[index]?.config.strictness ?? "balanced",
                    ),
                  );
                }}
                options={PROFILE_OPTIONS}
              />
            </div>
            <div className="field">
              <span>{t("sourcesStrictness")}</span>
              <Select
                label={t("sourcesStrictness")}
                value={draft.config.strictness}
                onChange={(value) => {
                  setState((s) =>
                    setLanguage(
                      s,
                      index,
                      s.sources[index]?.config.languageProfile ?? "auto",
                      value as LanguageStrictness,
                    ),
                  );
                }}
                options={STRICTNESS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
              />
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

function OverlayPreviewStep({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="step-preview">
        <h3 className="card-title" id="step-preview">
          {t("wizardOverlayPreview")}
        </h3>
        <p className="card-note">{t("wizardOverlayPreviewNote")}</p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`${t("wizardOverlayPreview")} ${draft.config.displayName}`}
        >
          <div className="card-head">
            <h4 className="card-title">{draft.config.displayName}</h4>
            <div className="form-row-inline">
              <input
                className="tag-input"
                type="text"
                value={draft.config.captionTag}
                maxLength={32}
                aria-label={`${t("wizardCaptionTag")} ${draft.config.displayName}`}
                onChange={(event) => {
                  setState((s) =>
                    updateSource(s, index, {
                      captionTag: event.currentTarget.value,
                    }),
                  );
                }}
              />
              <Select
                label={t("wizardCaptionStyle")}
                value={draft.config.labelStyle}
                onChange={(value) => {
                  setState((s) =>
                    updateSource(s, index, {
                      labelStyle: value as CaptionLabelStyle,
                    }),
                  );
                }}
                options={LABEL_STYLE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
              />
            </div>
          </div>
          <div
            className="preview-stage source-preview"
            aria-label={`Overlay preview ${draft.config.captionTag}`}
          >
            <div className="caption-entry">
              <p className="caption-english">
                {formatPreview(
                  draft.config.captionTag,
                  draft.config.labelStyle,
                  draft.presetId === "valorant-team"
                    ? SAMPLE_TEAM_CAPTION
                    : SAMPLE_DISCORD_CAPTION,
                )}
              </p>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

function SaveStep({ state }: { state: WizardState }) {
  const { error } = save(state);
  const t = useT();
  const count = state.sources.length;
  return (
    <section className="card" aria-labelledby="step-save">
      <h3 className="card-title" id="step-save">
        {t("wizardSavePreset")}
      </h3>
      <p className="card-note">
        {t("wizardSaveNote")
          .replace("{count}", String(count))
          .replace("{plural}", count === 1 ? "" : "s")}{" "}
        <strong>
          {state.mode === "recommended"
            ? t("wizardVoiceSetup")
            : t("wizardCustomRouting")}
        </strong>
        .
      </p>
      {error !== null && (
        <p className="field-errors" role="alert">
          {error}
        </p>
      )}
      <ul className="test-instructions">
        {state.sources.map((draft) => (
          <li key={draft.config.sourceId}>
            <strong>{draft.config.displayName}</strong> —{" "}
            {draft.config.captureTarget.kind === "endpoint"
              ? (draft.config.captureTarget.endpointId ?? t("wizardNoEndpoint"))
              : `process ${draft.config.captureTarget.processName}`}
            {draft.config.monitoring.enabled
              ? `, ${t("wizardMonitoringAt")} ${String(Math.round(draft.config.monitoring.volume * 100))}%`
              : `, ${t("wizardMonitoringOff")}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
