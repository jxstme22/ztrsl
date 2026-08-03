import { ArrowLeft, ArrowRight, Check, Info, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAudioMeter } from "../audio/useAudioMeter";
import { Select } from "../components/Select";
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
  WIZARD_STEP_LABELS,
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
  label: string;
}[] = [
  { value: "off", label: "Off — process any language" },
  { value: "balanced", label: "Balanced — prefer selected languages" },
  { value: "strict", label: "Strict — reject unexpected languages" },
];

const VB_CABLE_NOTICE =
  "VB-CABLE is installed separately from its official source (vb-audio.com). This app never bundles it.";

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

  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="wizard-title">
        <div className="card-head">
          <h2 className="card-title" id="wizard-title">
            Audio setup wizard
          </h2>
          <span className="pill on">
            <span aria-hidden="true" />
            Step {stepIndex + 1} of {WIZARD_STEP_IDS.length}
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
              <span>{WIZARD_STEP_LABELS[stepId]}</span>
            </li>
          ))}
        </ol>
      </section>

      {renderStep(state, step, audio, setState)}

      {state.saved ? (
        <section className="card" aria-labelledby="wizard-complete">
          <div className="card-head">
            <h3 className="card-title" id="wizard-complete">
              Setup saved
            </h3>
            <span className="pill on">
              <span aria-hidden="true" />
              <Check aria-hidden="true" size={12} />
              Done
            </span>
          </div>
          <p className="card-note">
            Your source presets are saved. Open Sources to edit them at any
            time; captions only start once live audio capture is enabled.
          </p>
          <div className="action-row">
            <button className="button primary" type="button" onClick={onFinish}>
              Open Sources
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
              Back
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
                {step === "save-preset" ? "Save preset" : "Next"}
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
) {
  switch (step) {
    case "choose-setup":
      return (
        <section className="card" aria-labelledby="step-choose">
          <h3 className="card-title" id="step-choose">
            Choose a setup type
          </h3>
          <div className="choice-grid">
            <SetupChoice
              title="Recommended"
              detail="One separately installed VB-CABLE for VALORANT voice + a second source for Discord."
              onClick={() => {
                setState((s) => selectMode(s, "recommended"));
              }}
            />
            <SetupChoice
              title="Advanced"
              detail="Multiple virtual audio endpoints or process captures for separate applications."
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
  return (
    <section
      className="card"
      aria-labelledby={`wizard-source-${config.sourceId}`}
    >
      <div className="card-head">
        <h4 className="card-title" id={`wizard-source-${config.sourceId}`}>
          {config.displayName.trim() === ""
            ? "Unnamed source"
            : config.displayName}
        </h4>
        <span className="pill">
          <span aria-hidden="true" />
          {config.sourceId.slice(0, 8)}
        </span>
      </div>
      <div className="form-grid">
        <div className="field">
          <span>Source name</span>
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
          <span>Caption tag</span>
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
          <span>Caption style</span>
          <Select
            label="Caption style"
            value={config.labelStyle}
            onChange={(value) => {
              setState((s) =>
                updateSource(s, draftIndex, {
                  labelStyle: value as CaptionLabelStyle,
                }),
              );
            }}
            options={LABEL_STYLE_OPTIONS}
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
  return (
    <>
      <section className="card" aria-labelledby="step-add-first">
        <h3 className="card-title" id="step-add-first">
          Add the first source
        </h3>
        <p className="card-note">
          Start from a preset, then edit the name, tag, and label style. The
          internal identity is assigned once and never changes.
        </p>
        <div className="action-row">
          <Select
            label="Preset"
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
            Add source
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
        group: endpoint.isSynthetic ? "Simulator" : "Windows audio endpoints",
      })),
    [audio.captureEndpoints],
  );
  return (
    <>
      <section className="card" aria-labelledby="step-capture">
        <h3 className="card-title" id="step-capture">
          Choose a capture method for each source
        </h3>
        <p className="card-note">
          Nothing is selected automatically. Pick the exact endpoint or process
          each voice channel comes from.
        </p>
        {!audio.catalog?.processCaptureSupported && (
          <p className="card-note wizard-note">
            Process capture (loopback of a named app) is not available yet on
            this build; choose endpoints for now.
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
            aria-label={`Capture for ${config.displayName}`}
          >
            <div className="card-head">
              <h4 className="card-title">{config.displayName}</h4>
              {draft.captureResolved ? (
                <span className="pill on">
                  <span aria-hidden="true" />
                  Set
                </span>
              ) : (
                <span className="pill">Unset</span>
              )}
            </div>
            <div className="form-grid">
              <div className="field">
                <span>Capture method</span>
                <Select
                  label="Capture method"
                  value={current}
                  placeholder="Choose an endpoint…"
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
                  Endpoint state:{" "}
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
  return (
    <section className="card" aria-labelledby="step-routing">
      <h3 className="card-title" id="step-routing">
        Route VALORANT audio
      </h3>
      <p className="card-note">{VB_CABLE_NOTICE}</p>
      <div className="routing-guide">
        <div>
          <strong>VALORANT game output</strong>
          <span>Physical headphones (unchanged)</span>
        </div>
        <div>
          <strong>VALORANT voice chat output</strong>
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
        <p className="card-note wizard-note">
          VB-CABLE detected: game voice can be captured as its own source.
        </p>
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
  return (
    <>
      <section className="card" aria-labelledby="step-social">
        <h3 className="card-title" id="step-social">
          Add a Discord or social source
        </h3>
        <p className="card-note">
          Recommended: capture Discord as its own source so friends' voices get
          their own caption lane.
        </p>
        <div className="action-row">
          <Select
            label="Preset"
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
            Add source
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
        group: endpoint.isSynthetic
          ? "Simulator"
          : "Windows playback endpoints",
      })),
    [audio.renderEndpoints],
  );
  return (
    <>
      <section className="card" aria-labelledby="step-monitor-out">
        <h3 className="card-title" id="step-monitor-out">
          Choose the monitoring output
        </h3>
        <p className="card-note">
          Monitoring blends captured voice into your headphones only. It never
          feeds translation. Beware of feedback loops, disconnected endpoints,
          and microphones selected as playback.
        </p>
        <div className="form-grid">
          <div className="field">
            <span>Headphone output</span>
            <Select
              label="Headphone output"
              value={state.monitorEndpointId ?? ""}
              placeholder="Choose an output…"
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
            aria-label={`Monitoring for ${config.displayName}`}
          >
            <div className="toggle-row">
              <div>
                <label htmlFor={`monitor-${config.sourceId}`}>
                  Monitor {config.displayName}
                </label>
                <p>Hear this source in your headphones while playing.</p>
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
                Captures and monitors the same endpoint — audio would loop.
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
  return (
    <section className="card" aria-labelledby={meterLabel}>
      <h4 className="card-title" id={meterLabel}>
        {source?.config.displayName ?? "Source"} live meter
      </h4>
      <p className="card-note">{instruction}</p>
      <div className="form-grid">
        <div className="field">
          <span>Endpoint under test</span>
          <Select
            label="Endpoint under test"
            value={currentTarget ?? ""}
            placeholder="Choose an endpoint…"
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
          <span>Input level</span>
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
  return (
    <>
      <section className="card" aria-labelledby="step-isolation">
        <h3 className="card-title" id="step-isolation">
          Source isolation test
        </h3>
        <p className="card-note">
          Each source must only ever hear its own voice channel. Play voice into
          the cable and confirm only its meter moves.
        </p>
        <ul className="test-instructions">
          <li>Play voice into the selected cable (or another app's voice).</li>
          <li>Trigger VALORANT game or announcer audio.</li>
          <li>The TEAM meter must move only for voice into the cable.</li>
          <li>The other source's meter must stay silent.</li>
        </ul>
      </section>
      <MeterCard
        state={state}
        audio={audio}
        sourceIndex={teamIndex === -1 ? 0 : teamIndex}
        instruction="TEAM: should move only when voice plays into its cable."
      />
      {socialIndex !== -1 && (
        <MeterCard
          state={state}
          audio={audio}
          sourceIndex={socialIndex}
          instruction="SOCIAL: must stay silent when VALORANT game audio plays."
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
  return (
    <>
      <section className="card" aria-labelledby="step-monitor-test">
        <h3 className="card-title" id="step-monitor-test">
          Monitoring test
        </h3>
        <p className="card-note">
          All enabled voice sources should be audible in your headphones without
          feedback. Adjust each blend; verify by ear. The blend never enters
          translation.
        </p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`Blend for ${draft.config.displayName}`}
        >
          <div className="range-field">
            <div className="range-label">
              <label htmlFor={`blend-${draft.config.sourceId}`}>
                {draft.config.displayName} blend
              </label>
              <output htmlFor={`blend-${draft.config.sourceId}`}>
                {draft.config.monitoring.enabled
                  ? `${String(Math.round(draft.config.monitoring.volume * 100))}%`
                  : "off"}
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
        instruction="Optional: confirm the blend output still carries voice."
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
  return (
    <>
      <section className="card" aria-labelledby="step-language">
        <h3 className="card-title" id="step-language">
          Language profile and strictness per source
        </h3>
        <p className="card-note">
          Balanced is recommended for mixed gaming speech. Strict rejects
          unexpected languages more aggressively.
        </p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`Language for ${draft.config.displayName}`}
        >
          <div className="form-grid">
            <div className="field">
              <span>{draft.config.displayName} profile</span>
              <Select
                label="Language profile"
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
              <span>Strictness</span>
              <Select
                label="Strictness"
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
                options={STRICTNESS_OPTIONS}
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
  return (
    <>
      <section className="card" aria-labelledby="step-preview">
        <h3 className="card-title" id="step-preview">
          Overlay preview
        </h3>
        <p className="card-note">
          Both captions appear at once, each in its own lane. Edit tags and
          label styles directly.
        </p>
      </section>
      {state.sources.map((draft, index) => (
        <section
          className="card"
          key={draft.config.sourceId}
          aria-label={`Preview for ${draft.config.displayName}`}
        >
          <div className="card-head">
            <h4 className="card-title">{draft.config.displayName}</h4>
            <div className="form-row-inline">
              <input
                className="tag-input"
                type="text"
                value={draft.config.captionTag}
                maxLength={32}
                aria-label={`Tag for ${draft.config.displayName}`}
                onChange={(event) => {
                  setState((s) =>
                    updateSource(s, index, {
                      captionTag: event.currentTarget.value,
                    }),
                  );
                }}
              />
              <Select
                label="Label style"
                value={draft.config.labelStyle}
                onChange={(value) => {
                  setState((s) =>
                    updateSource(s, index, {
                      labelStyle: value as CaptionLabelStyle,
                    }),
                  );
                }}
                options={LABEL_STYLE_OPTIONS}
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
  return (
    <section className="card" aria-labelledby="step-save">
      <h3 className="card-title" id="step-save">
        Save preset
      </h3>
      <p className="card-note">
        Saving writes {state.sources.length} source preset
        {state.sources.length === 1 ? "" : "s"} to this device. Suggested name:{" "}
        <strong>
          {state.mode === "recommended" ? "Voice setup" : "Custom routing"}
        </strong>
        . Presets populate defaults only — every field stays editable in
        Sources.
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
              ? (draft.config.captureTarget.endpointId ?? "no endpoint yet")
              : `process ${draft.config.captureTarget.processName}`}
            {draft.config.monitoring.enabled
              ? `, monitored at ${String(Math.round(draft.config.monitoring.volume * 100))}%`
              : ", monitoring off"}
          </li>
        ))}
      </ul>
    </section>
  );
}
