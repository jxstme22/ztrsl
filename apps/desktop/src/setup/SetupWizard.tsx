import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Play, RefreshCw } from "lucide-react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import { useT } from "../features/i18n/store";
import type { UIKey } from "../features/i18n/strings";
import { saveQualityProfileId } from "../presets/quality";
import { USE_CASES, type UseCaseId } from "./useCases";
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

const USE_CASE_NAME_KEYS: Record<UseCaseId, UIKey> = {
  valorant: "useCaseValorant",
  discord: "useCaseDiscord",
  meeting: "useCaseMeeting",
  browser_call: "useCaseBrowserCall",
  other: "useCaseOther",
};

/**
 * DS-501+: guided setup wizard. Walks through use case → cable detection →
 * routing → capture/monitor selection → signal test → isolation test →
 * review. Everything the wizard verifies is persisted as a routing profile
 * plus the Live panel's own input/monitor keys, so a verified session can
 * start without re-running the wizard.
 */
export function SetupWizard({ audio }: { audio: AudioController }) {
  const t = useT();
  const [state, dispatch] = useReducer(
    wizardReducer,
    undefined,
    initialWizardState,
  );
  const [profileName, setProfileName] = useState("My setup");
  const [measuring, setMeasuring] = useState<
    null | "signal" | "non_voice" | "voice"
  >(null);
  const [nonVoiceActivity, setNonVoiceActivity] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const measureTimer = useRef<number | null>(null);
  const samples = useRef<FrameStats[]>([]);

  const cable = audio.catalog ? detectVbCable(audio.catalog) : null;
  const useCase = state.useCaseId
    ? USE_CASES[state.useCaseId as keyof typeof USE_CASES]
    : null;

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
        if (
          audio.selectedEndpointId === null &&
          state.captureEndpointId !== null
        ) {
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
    const profile = profileFromWizard(
      state,
      profileName.trim() || "My setup",
      {
        id,
        sourceOrigin: useCase.suggestedSourceOrigin,
        domainPresetId: useCase.suggestedPresetId,
        qualityProfileId: "balanced",
        vadProfileId: useCase.suggestedVadProfileId,
      },
    );
    saveRoutingProfiles([...loadRoutingProfiles(), profile]);
    saveQualityProfileId("balanced");
    window.localStorage.setItem(INPUT_ENDPOINT_KEY, state.captureEndpointId);
    if (state.monitorEndpointId) {
      window.localStorage.setItem(
        "lst.live.playback-endpoint",
        state.monitorEndpointId,
      );
    }
    window.localStorage.setItem(
      MONITOR_ENABLED_KEY,
      String(state.monitoringEnabled),
    );
    setSavedId(id);
    dispatch({ type: "save" });
  };

  const stepTitle: Record<WizardState["step"], UIKey> = {
    choose_use_case: "wizardStepChooseUseCase",
    detect_cable: "wizardStepDetectCable",
    show_routing: "wizardStepShowRouting",
    select_capture: "wizardStepSelectCapture",
    select_monitor: "wizardStepSelectMonitor",
    test_signal: "wizardStepTestSignal",
    test_isolation: "wizardStepTestIsolation",
    review: "wizardStepReview",
    saved: "wizardStepSaved",
  };

  const signalLabels: Record<SignalLevel, UIKey> = {
    healthy: "wizardSignalHealthy",
    silent: "wizardSignalSilent",
    very_quiet: "wizardSignalVeryQuiet",
    clipping: "wizardSignalClipping",
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

  const stepNumber =
    state.step === "saved"
      ? "8/8"
      : `${String(Object.keys(stepTitle).indexOf(state.step) + 1)}/8`;

  return (
    <section className="card lst-section-card setup-wizard">
      <div className="card-head">
        <h3 className="card-title">{t("wizardTitle")}</h3>
        <span className="lst-model-count pill">
          {t("wizardStepCount").replace("{n}", stepNumber)}
        </span>
      </div>

      <p className="setup-wizard-step-title">{t(stepTitle[state.step])}</p>

      {state.step === "choose_use_case" && (
        <div className="setup-options">
          {Object.values(USE_CASES).map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`button ${state.useCaseId === candidate.id ? "on" : ""}`}
              onClick={() => {
                dispatch({ type: "select_use_case", useCaseId: candidate.id });
              }}
            >
              {t(USE_CASE_NAME_KEYS[candidate.id])}
            </button>
          ))}
        </div>
      )}

      {state.step === "detect_cable" && (
        <div>
          {cable === null ? (
            <p className="diag-hint">{t("wizardHintDetecting")}</p>
          ) : cable.installed ? (
            <p className="diag-hint ok">
              {t("wizardCableFound").replace(
                "{ids}",
                cable.input && cable.output
                  ? `${cable.input.friendlyName} → ${cable.output.friendlyName}`
                  : "",
              )}
            </p>
          ) : (
            <p className="diag-hint warn">{t("wizardCableMissing")}</p>
          )}
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              dispatch({ type: "refresh_devices" });
              audio.refresh().catch(() => undefined);
            }}
          >
            <RefreshCw aria-hidden="true" size={14} /> {t("wizardRefreshDevices")}
          </button>
        </div>
      )}

      {state.step === "show_routing" && useCase && (
        <ul className="setup-routing-list">
          <li>
            {t("wizardRouteSourceName").replace(
              "{value}",
              useCase.suggestedSourceName,
            )}
          </li>
          <li>
            {t("wizardRouteOrigin").replace(
              "{value}",
              useCase.suggestedSourceOrigin,
            )}
          </li>
          <li>
            {t("wizardRoutePreset").replace(
              "{value}",
              useCase.suggestedPresetId,
            )}
          </li>
          <li>
            {t("wizardRouteVad").replace(
              "{value}",
              useCase.suggestedVadProfileId,
            )}
          </li>
          <li>
            {t("wizardRouteMonitor").replace(
              "{value}",
              useCase.defaultMonitoring ? t("wizardYes") : t("wizardNo"),
            )}
          </li>
        </ul>
      )}

      {state.step === "select_capture" && (
        <div>
          {audio.captureEndpoints.length === 0 ? (
            <p className="diag-hint warn">{t("wizardNoCapture")}</p>
          ) : (
            <select
              className="setup-select"
              value={state.captureEndpointId ?? ""}
              onChange={(event) => {
                dispatch({
                  type: "select_capture",
                  endpointId: event.currentTarget.value,
                });
                audio.selectEndpoint(event.currentTarget.value);
              }}
            >
              <option value="">{t("wizardChooseInput")}</option>
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
              onChange={(event) => {
                dispatch({
                  type: "toggle_monitoring",
                  enabled: event.currentTarget.checked,
                });
              }}
            />
            {t("wizardPlayCapturedBack")}
          </label>
          {state.monitoringEnabled && (
            <select
              className="setup-select"
              value={state.monitorEndpointId ?? ""}
              onChange={(event) => {
                dispatch({
                  type: "select_monitor",
                  endpointId: event.currentTarget.value,
                });
              }}
            >
              <option value="">{t("wizardChooseOutput")}</option>
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
          <p className="diag-hint">{t("wizardSignalIntro")}</p>
          <button
            type="button"
            className="button"
            disabled={measuring !== null}
            onClick={() => {
              measure("signal", 2);
            }}
          >
            {measuring === "signal" ? (
              t("wizardMeasuringSignal")
            ) : (
              <>
                <Play aria-hidden="true" size={14} /> {t("wizardMeasure")}
              </>
            )}
          </button>
          {state.signalResult && (
            <p className="diag-hint ok">{t(signalLabels[state.signalResult])}</p>
          )}
        </div>
      )}

      {state.step === "test_isolation" && (
        <div>
          <p className="diag-hint">{t("wizardIsolationIntro")}</p>
          {nonVoiceActivity === null ? (
            <button
              type="button"
              className="button"
              disabled={measuring !== null}
              onClick={() => {
                measure("non_voice", 2);
              }}
            >
              {measuring === "non_voice"
                ? t("wizardStayQuiet")
                : t("wizardMeasureSilence")}
            </button>
          ) : (
            <div>
              <p className="diag-hint ok">{t("wizardSilenceMeasured")}</p>
              <button
                type="button"
                className="button"
                disabled={measuring !== null}
                onClick={() => {
                  measure("voice", 2);
                }}
              >
                {measuring === "voice"
                  ? t("wizardListeningSpeak")
                  : t("wizardMeasureVoice")}
              </button>
            </div>
          )}
          {state.isolationResult && (
            <p className="diag-hint ok">
              {state.isolationResult === "passed"
                ? t("wizardIsolationPassed")
                : state.isolationResult === "failed_no_voice"
                  ? t("wizardIsolationNoVoice")
                  : t("wizardIsolationLeak")}
            </p>
          )}
        </div>
      )}

      {state.step === "review" && (
        <div>
          <ul className="setup-routing-list">
            <li>
              {t("wizardReviewUseCase").replace(
                "{value}",
                state.useCaseId ? t(USE_CASE_NAME_KEYS[state.useCaseId as UseCaseId]) : "—",
              )}
            </li>
            <li>
              {t("wizardReviewInput").replace(
                "{value}",
                audio.captureEndpoints.find(
                  (e) => e.id === state.captureEndpointId,
                )?.friendlyName ?? "—",
              )}
            </li>
            <li>
              {t("wizardReviewMonitor").replace(
                "{value}",
                state.monitoringEnabled
                  ? audio.renderEndpoints.find(
                      (e) => e.id === state.monitorEndpointId,
                    )?.friendlyName ?? "—"
                  : t("wizardNo"),
              )}
            </li>
            <li>
              {t("wizardReviewSignal").replace(
                "{value}",
                state.signalResult
                  ? t(signalLabels[state.signalResult])
                  : "—",
              )}
            </li>
            <li>
              {t("wizardReviewIsolation").replace(
                "{value}",
                state.isolationResult === "passed"
                  ? t("wizardIsolationPassed")
                  : state.isolationResult === "failed_no_voice"
                    ? t("wizardIsolationNoVoice")
                    : state.isolationResult === "failed_non_voice_leak"
                      ? t("wizardIsolationLeak")
                      : "—",
              )}
            </li>
          </ul>
          <div className="field">
            <label htmlFor="setup-profile-name">{t("wizardProfileName")}</label>
            <input
              id="setup-profile-name"
              type="text"
              value={profileName}
              onChange={(event) => {
                setProfileName(event.currentTarget.value);
              }}
            />
          </div>
          <button type="button" className="button" onClick={onSave}>
            <Check aria-hidden="true" size={14} /> {t("wizardSaveSetup")}
          </button>
        </div>
      )}

      {state.step === "saved" && (
        <div>
          <p className="diag-hint ok">
            {t("wizardSavedHint").replace(
              "{id}",
              savedId ?? "",
            )}
          </p>
        </div>
      )}

      <div className="setup-wizard-nav">
        {state.step !== "choose_use_case" && state.step !== "saved" && (
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              dispatch({ type: "back" });
            }}
          >
            <ArrowLeft aria-hidden="true" size={14} /> {t("wizardBack")}
          </button>
        )}
        {state.step !== "saved" && (
          <button
            type="button"
            className="button btn-shine"
            disabled={!canNext}
            onClick={() => {
              dispatch({ type: "next" });
            }}
          >
            {t("wizardNext")} <ArrowRight aria-hidden="true" size={14} />
          </button>
        )}
        {state.step !== "choose_use_case" && state.step !== "saved" && (
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              dispatch({ type: "cancel" });
            }}
          >
            {t("wizardCancel")}
          </button>
        )}
      </div>
    </section>
  );
}
