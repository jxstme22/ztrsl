import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Play, RefreshCw } from "lucide-react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import { saveQualityProfileId } from "../presets/quality";
import { USE_CASES } from "./useCases";
import { detectVbCable } from "./vbCable";
import {
  classifySignalLevel,
  decideIsolationResult,
  type FrameStats,
} from "./signalTest";
import {
  initialWizardState,
  wizardReducer,
  type SignalLevel,
  type WizardState,
} from "./wizardState";
import {
  loadRoutingProfiles,
  profileFromWizard,
  saveRoutingProfiles,
} from "./routingProfiles";

const INPUT_ENDPOINT_KEY = "lst.live.input-endpoint";
const MONITOR_ENABLED_KEY = "lst.live.monitor";

type AudioController = ReturnType<typeof useAudioMeter>;

/**
 * DS-501+: guided setup wizard. Walks through use case → cable detection →
 * routing → capture/monitor selection → signal test → isolation test →
 * review. Everything the wizard verifies is persisted as a routing profile
 * plus the Live panel's own input/monitor keys, so a verified session can
 * start without re-running the wizard.
 */
export function SetupWizard({ audio }: { audio: AudioController }) {
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const [profileName, setProfileName] = useState("My setup");
  const [measuring, setMeasuring] = useState<null | "signal" | "non_voice" | "voice">(
    null,
  );
  const [nonVoiceActivity, setNonVoiceActivity] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const measureTimer = useRef<number | null>(null);
  const samples = useRef<FrameStats[]>([]);

  const cable = audio.catalog ? detectVbCable(audio.catalog) : null;
  const useCase = state.useCaseId ? USE_CASES[state.useCaseId as keyof typeof USE_CASES] : null;

  useEffect(() => {
    audio.refresh().catch(() => undefined);
  }, [audio]);

  useEffect(() => {
    return () => {
      if (measureTimer.current !== null) {
        window.clearInterval(measureTimer.current);
      }
      if (audio.active) {
        void audio.stop();
      }
    };
  }, [audio]);

  const measure = useCallback(
    (kind: "signal" | "non_voice" | "voice", seconds: number) => {
      setMeasuring(kind);
      samples.current = [];
      if (!audio.active) {
        if (audio.selectedEndpointId === null && state.captureEndpointId !== null) {
          audio.selectEndpoint(state.captureEndpointId);
        }
        void audio.start();
      }
      const startedAt = performance.now();
      measureTimer.current = window.setInterval(() => {
        samples.current.push({
          rms: audio.level.rms,
          peak: audio.level.peak,
          clippingRatio: audio.level.clipped ? 0.05 : 0,
        });
        if (performance.now() - startedAt >= seconds * 1000) {
          if (measureTimer.current !== null) {
            window.clearInterval(measureTimer.current);
          }
          measureTimer.current = null;
          const peakRms = Math.max(...samples.current.map((s) => s.rms), 0);
          const peakPeak = Math.max(...samples.current.map((s) => s.peak), 0);
          const clipped = samples.current.some((s) => s.clippingRatio > 0);
          if (kind === "signal") {
            dispatch({
              type: "signal_result",
              result: classifySignalLevel({
                rms: peakRms,
                peak: peakPeak,
                clippingRatio: clipped ? 0.05 : 0,
              }),
            });
          } else {
            const activity = Math.min(1, peakRms / 0.05);
            if (kind === "non_voice") {
              setNonVoiceActivity(activity);
            } else {
              dispatch({
                type: "isolation_result",
                result: decideIsolationResult(nonVoiceActivity ?? 1, activity),
              });
            }
          }
          setMeasuring(null);
        }
      }, 100);
    },
    [audio, state.captureEndpointId, nonVoiceActivity],
  );

  const onSave = () => {
    if (!useCase || state.captureEndpointId === null) {
      return;
    }
    if (audio.active) {
      void audio.stop();
    }
    const id = `profile-${String(Date.now())}`;
    const profile = profileFromWizard(state, profileName.trim() || "My setup", {
      id,
      sourceOrigin: useCase.suggestedSourceOrigin,
      domainPresetId: useCase.suggestedPresetId,
      qualityProfileId: "balanced",
      vadProfileId: useCase.suggestedVadProfileId,
    });
    saveRoutingProfiles([...loadRoutingProfiles(), profile]);
    saveQualityProfileId("balanced");
    window.localStorage.setItem(INPUT_ENDPOINT_KEY, state.captureEndpointId);
    if (state.monitorEndpointId) {
      window.localStorage.setItem("lst.live.playback-endpoint", state.monitorEndpointId);
    }
    window.localStorage.setItem(MONITOR_ENABLED_KEY, String(state.monitoringEnabled));
    setSavedId(id);
    dispatch({ type: "save" });
  };

  const stepTitle: Record<WizardState["step"], string> = {
    choose_use_case: "What will you use yTSRL with?",
    detect_cable: "Virtual cable check",
    show_routing: "How this setup routes audio",
    select_capture: "Choose the input to capture",
    select_monitor: "Monitor the captured audio?",
    test_signal: "Voice signal test",
    test_isolation: "Isolation check",
    review: "Review and save",
    saved: "Setup saved",
  };

  const signalLabels: Record<SignalLevel, string> = {
    healthy: "Voice detected — signal looks healthy.",
    silent: "No signal. Check the app outputs to the cable input.",
    very_quiet: "Signal is very quiet — raise the source volume.",
    clipping: "Signal is clipping — lower the source volume.",
  };

  const canNext = (() => {
    switch (state.step) {
      case "choose_use_case":
        return state.useCaseId !== null;
      case "select_capture":
        return state.captureEndpointId !== null;
      case "select_monitor":
        return !state.monitoringEnabled || state.monitorEndpointId !== null;
      case "test_signal":
        return state.signalResult !== null;
      case "test_isolation":
        return state.isolationResult !== null;
      default:
        return true;
    }
  })();

  return (
    <section className="card lst-section-card setup-wizard">
      <div className="card-head">
        <h3 className="card-title">Create a profile</h3>
        <span className="lst-model-count pill">
          Step{" "}
          {state.step === "saved"
            ? "8/8"
            : `${String(Object.keys(stepTitle).indexOf(state.step) + 1)}/8`}
        </span>
      </div>

      <p className="setup-wizard-step-title">{stepTitle[state.step]}</p>

      {state.step === "choose_use_case" && (
        <div className="setup-options">
          {Object.values(USE_CASES).map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`button ${state.useCaseId === candidate.id ? "on" : ""}`}
              onClick={() => { dispatch({ type: "select_use_case", useCaseId: candidate.id }); }}
            >
              {candidate.displayName}
            </button>
          ))}
        </div>
      )}

      {state.step === "detect_cable" && (
        <div>
          {cable === null ? (
            <p className="diag-hint">Detecting virtual cable devices…</p>
          ) : cable.installed ? (
            <p className="diag-hint ok">
              Found a virtual cable
              {cable.input && cable.output
                ? ` (${cable.input.friendlyName} → ${cable.output.friendlyName})`
                : ""}
              . The application you listen to outputs here; yTSRL captures it.
            </p>
          ) : (
            <p className="diag-hint warn">
              No virtual cable detected. Install VB-CABLE (Windows) or BlackHole (macOS), then
              refresh. You can still continue and pick a different input.
            </p>
          )}
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              dispatch({ type: "refresh_devices" });
              audio.refresh().catch(() => undefined);
            }}
          >
            <RefreshCw aria-hidden="true" size={14} /> Refresh devices
          </button>
        </div>
      )}

      {state.step === "show_routing" && useCase && (
        <ul className="setup-routing-list">
          <li>
            Source name suggestion: <strong>{useCase.suggestedSourceName}</strong>
          </li>
          <li>
            Audio origin: <strong>{useCase.suggestedSourceOrigin}</strong>
          </li>
          <li>
            Domain preset: <strong>{useCase.suggestedPresetId}</strong>
          </li>
          <li>
            VAD profile: <strong>{useCase.suggestedVadProfileId}</strong>
          </li>
          <li>
            Monitor captured audio by default:{" "}
            <strong>{useCase.defaultMonitoring ? "yes" : "no"}</strong>
          </li>
        </ul>
      )}

      {state.step === "select_capture" && (
        <div>
          {audio.captureEndpoints.length === 0 ? (
            <p className="diag-hint warn">No capture endpoints found. Refresh the device list.</p>
          ) : (
            <select
              className="setup-select"
              value={state.captureEndpointId ?? ""}
              onChange={(event) => {
                dispatch({ type: "select_capture", endpointId: event.currentTarget.value });
                audio.selectEndpoint(event.currentTarget.value);
              }}
            >
              <option value="">Choose an input…</option>
              {audio.captureEndpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.friendlyName}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {state.step === "select_monitor" && (
        <div>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={state.monitoringEnabled}
              onChange={(event) =>
                { dispatch({ type: "toggle_monitoring", enabled: event.currentTarget.checked }); }
              }
            />
            Play the captured audio back so I can hear it
          </label>
          {state.monitoringEnabled && (
            <select
              className="setup-select"
              value={state.monitorEndpointId ?? ""}
              onChange={(event) =>
                { dispatch({ type: "select_monitor", endpointId: event.currentTarget.value }); }
              }
            >
              <option value="">Choose an output…</option>
              {audio.renderEndpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.friendlyName}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {state.step === "test_signal" && (
        <div>
          <p className="diag-hint">
            Speak into the captured channel. yTSRL measures your voice level for 2 seconds.
          </p>
          <button
            type="button"
            className="button"
            disabled={measuring !== null}
            onClick={() => { measure("signal", 2); }}
          >
            {measuring === "signal" ? "Measuring… speak now" : <><Play aria-hidden="true" size={14} /> Measure</>}
          </button>
          {state.signalResult && (
            <p className="diag-hint ok">{signalLabels[state.signalResult]}</p>
          )}
        </div>
      )}

      {state.step === "test_isolation" && (
        <div>
          <p className="diag-hint">
            Two checks: stay quiet for 2 seconds, then speak for 2 seconds.
          </p>
          {nonVoiceActivity === null ? (
            <button
              type="button"
              className="button"
              disabled={measuring !== null}
              onClick={() => { measure("non_voice", 2); }}
            >
              {measuring === "non_voice" ? "Stay quiet…" : "1) Measure silence"}
            </button>
          ) : (
            <div>
              <p className="diag-hint ok">Silence measured. Now speak normally.</p>
              <button
                type="button"
                className="button"
                disabled={measuring !== null}
                onClick={() => { measure("voice", 2); }}
              >
                {measuring === "voice" ? "Listening… speak" : "2) Measure voice"}
              </button>
            </div>
          )}
          {state.isolationResult && (
            <p className="diag-hint ok">
              {state.isolationResult === "passed"
                ? "Isolation looks correct: silence stays silent, voice comes through."
                : state.isolationResult === "failed_no_voice"
                  ? "No voice detected during the speech check — verify the source."
                  : "Non-voice audio leaks through — check what else outputs to this channel."}
            </p>
          )}
        </div>
      )}

      {state.step === "review" && (
        <div>
          <ul className="setup-routing-list">
            <li>
              Use case: <strong>{useCase?.displayName ?? "—"}</strong>
            </li>
            <li>
              Capture input:{" "}
              <strong>
                {audio.captureEndpoints.find((e) => e.id === state.captureEndpointId)?.friendlyName ??
                  "—"}
              </strong>
            </li>
            <li>
              Monitor:{" "}
              <strong>
                {state.monitoringEnabled
                  ? audio.renderEndpoints.find((e) => e.id === state.monitorEndpointId)?.friendlyName ??
                    "—"
                  : "off"}
              </strong>
            </li>
            <li>
              Signal: <strong>{state.signalResult ?? "—"}</strong>
            </li>
            <li>
              Isolation: <strong>{state.isolationResult ?? "—"}</strong>
            </li>
          </ul>
          <div className="field">
            <label htmlFor="setup-profile-name">Profile name</label>
            <input
              id="setup-profile-name"
              type="text"
              value={profileName}
              onChange={(event) => { setProfileName(event.currentTarget.value); }}
            />
          </div>
          <button type="button" className="button" onClick={onSave}>
            <Check aria-hidden="true" size={14} /> Save setup
          </button>
        </div>
      )}

      {state.step === "saved" && (
        <div>
          <p className="diag-hint ok">
            Setup saved {savedId !== null ? `(${savedId})` : ""}. The Live page is configured with
            this input, and the routing profile is stored for recovery.
          </p>
        </div>
      )}

      <div className="setup-wizard-nav">
        {state.step !== "choose_use_case" && state.step !== "saved" && (
          <button type="button" className="button quiet" onClick={() => { dispatch({ type: "back" }); }}>
            <ArrowLeft aria-hidden="true" size={14} /> Back
          </button>
        )}
        {state.step !== "saved" && (
          <button
            type="button"
            className="button"
            disabled={!canNext}
            onClick={() => { dispatch({ type: "next" }); }}
          >
            Next <ArrowRight aria-hidden="true" size={14} />
          </button>
        )}
        {state.step !== "choose_use_case" && state.step !== "saved" && (
          <button type="button" className="button quiet" onClick={() => { dispatch({ type: "cancel" }); }}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
