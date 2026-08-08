/**
 * Frontend mirror of the sidecar's source-origin processing policy
 * (DS-303). The sidecar remains the runtime source of truth; this module
 * only feeds the preset resolver's effective configuration preview.
 */

export type OriginPolicy = {
  normalize: boolean;
  additionalSuppression: boolean;
  echoHandling: boolean;
  strictSpeechValidation: boolean;
  vadEnabled: boolean;
};

const DEFAULT_POLICY: OriginPolicy = {
  normalize: false,
  additionalSuppression: false,
  echoHandling: false,
  strictSpeechValidation: false,
  vadEnabled: true,
};

const ORIGIN_POLICIES: Record<string, OriginPolicy> = {
  virtual_voice_channel: { ...DEFAULT_POLICY },
  physical_microphone: { ...DEFAULT_POLICY, normalize: true },
  application_audio: { ...DEFAULT_POLICY },
  system_mix: { ...DEFAULT_POLICY, strictSpeechValidation: true },
  recorded_file: { ...DEFAULT_POLICY, vadEnabled: false },
};

export function policy_for_origin(sourceOrigin: string): OriginPolicy {
  return ORIGIN_POLICIES[sourceOrigin] ?? DEFAULT_POLICY;
}
