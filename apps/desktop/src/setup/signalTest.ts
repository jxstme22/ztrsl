import type { SignalLevel, IsolationResult } from "./wizardState";

/**
 * DS-506/DS-507: voice-signal and isolation test decisions (pure logic).
 * Deterministic thresholds; the wizard component drives the capture and
 * collects frame statistics. No models are loaded for these tests.
 */

export const SIGNAL_SILENT_RMS = 0.004;
export const SIGNAL_QUIET_RMS = 0.018;
export const SIGNAL_CLIPPING_RATIO = 0.02;

export type FrameStats = { rms: number; peak: number; clippingRatio: number };

export const SIGNAL_MESSAGES: Record<SignalLevel, string> = {
  healthy: "Voice detected. Signal level is healthy.",
  silent:
    "No signal detected. Check that the application outputs to CABLE Input.",
  very_quiet: "Signal is very quiet. Increase the application output volume.",
  clipping: "Signal is clipping. Lower the application output volume.",
};

export function classifySignalLevel(stats: FrameStats): SignalLevel {
  if (!Number.isFinite(stats.rms) || !Number.isFinite(stats.peak)) {
    return "silent";
  }
  if (stats.clippingRatio >= SIGNAL_CLIPPING_RATIO) {
    return "clipping";
  }
  if (stats.rms >= SIGNAL_QUIET_RMS) {
    return "healthy";
  }
  if (stats.rms >= SIGNAL_SILENT_RMS) {
    return "very_quiet";
  }
  return "silent";
}

export const ISOLATION_NON_VOICE_LIMIT = 0.15;
export const ISOLATION_VOICE_LIMIT = 0.3;

/**
 * Compare measured activity with no one speaking (nonVoiceActivity) vs
 * while someone speaks (voiceActivity), each 0..1. This is a routing
 * sanity check, not perfect acoustic classification — inconclusive results
 * do not block advanced users but show a warning.
 */
export function decideIsolationResult(
  nonVoiceActivity: number,
  voiceActivity: number,
): IsolationResult {
  const nonVoiceLow = nonVoiceActivity <= ISOLATION_NON_VOICE_LIMIT;
  const voiceClear = voiceActivity >= ISOLATION_VOICE_LIMIT;
  if (nonVoiceLow && voiceClear) {
    return "passed";
  }
  if (!nonVoiceLow) {
    return "failed_non_voice_leak";
  }
  if (!voiceClear) {
    return "failed_no_voice";
  }
  return "inconclusive";
}
