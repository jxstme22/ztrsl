import type { LanguageProfile, LanguageStrictness } from "./model";

/**
 * Desktop mirror of the sidecar language profile catalog (Phase 7, spec §6.2).
 * The sidecar is the source of truth for gate behavior; this module only holds
 * display metadata plus the capability-honesty table so the UI can describe a
 * profile without ever overstating what the active decoder can enforce.
 */

export type ProfileMeta = {
  label: string;
  description: string;
  recommendedStrictness: LanguageStrictness;
  /** Whisper ISO-639-1 token the profile is forced to, or null = auto-detect. */
  forcedAsrLanguage: string | null;
};

export const PROFILE_META: Record<LanguageProfile, ProfileMeta> = {
  tagalog: {
    label: "Tagalog",
    description: "Pure Tagalog — English terms are flagged as mismatches.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: "tl",
  },
  taglish: {
    label: "Taglish",
    description: "Tagalog with common English terms allowed.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: "tl",
  },
  cebuano: {
    label: "Cebuano",
    description: "Cebuano/Bisaya — misheard English is flagged.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: "tl",
  },
  bislish: {
    label: "Bislish",
    description: "Cebuano mixed with English terms.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: "tl",
  },
  mandarin: {
    label: "Mandarin",
    description: "Mandarin party voice — English speech is flagged.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: "zh",
  },
  chinese_english: {
    label: "Chinese / English",
    description: "Mixed Mandarin + English party voice.",
    recommendedStrictness: "balanced",
    forcedAsrLanguage: null,
  },
  auto: {
    label: "Auto",
    description: "Accept any language; filtering is minimal.",
    recommendedStrictness: "off",
    forcedAsrLanguage: null,
  },
};

export const PROFILE_IDS: LanguageProfile[] = Object.keys(
  PROFILE_META,
) as LanguageProfile[];

export const STRICTNESS_META: Record<
  LanguageStrictness,
  { label: string; description: string }
> = {
  off: {
    label: "Off",
    description: "Accept everything and translate it.",
  },
  balanced: {
    label: "Balanced",
    description: "Filter clear mismatches and junk transcripts.",
  },
  strict: {
    label: "Strict",
    description: "Suppress anything that is not the profile's language.",
  },
};

export const STRICTNESS_IDS: LanguageStrictness[] = ["off", "balanced", "strict"];

export const PROFILE_OPTIONS = PROFILE_IDS.map((id) => ({
  value: id,
  label: PROFILE_META[id].label,
}));
export const STRICTNESS_OPTIONS = STRICTNESS_IDS.map((id) => ({
  value: id,
  label: STRICTNESS_META[id].label,
}));

/**
 * Capability honesty (spec §6.4 / ADR-016): what a provider can actually do
 * with the profile's forced language.
 *
 * - `forced`: the decoder is a single-language model — its output cannot be a
 *   different language (CTC Tagalog / Mandarin NCSpeech). The UI may say the
 *   source is "locked" to that language.
 * - `preferred`: decoder biased toward the language token but still
 *   multilingual — never present it as a hard lock.
 * - `post-filter`: decoder is not language-constrained at all; recognition
 *   runs normally and the language gate only filters after the fact.
 *
 * This table is intentionally conservative. New providers (Phase 9 catalog)
 * must add an explicit capability; the default is `post-filter` so the UI can
 * never overclaim.
 */
export type ProviderCapability = "forced" | "preferred" | "post-filter";

export const ASR_PROVIDER_CAPABILITY: Record<string, ProviderCapability> = {
  ncspeech: "forced",
  "ncspeech-zh": "forced",
  "ncspeech-zh-parakeet": "forced",
  local: "preferred",
  "whisper-turbo": "preferred",
  "whisper-full": "preferred",
  "groq-whisper": "preferred",
  demo: "post-filter",
};

export const DEFAULT_PROVIDER_CAPABILITY: ProviderCapability = "post-filter";

export function providerCapability(provider: string | undefined): ProviderCapability {
  if (provider === undefined) return DEFAULT_PROVIDER_CAPABILITY;
  return ASR_PROVIDER_CAPABILITY[provider] ?? DEFAULT_PROVIDER_CAPABILITY;
}

const CAPABILITY_NOTES: Record<ProviderCapability, string> = {
  forced:
    "This decoder is fixed to one language, so the profile's language is enforced at recognition.",
  preferred:
    "This decoder is biased toward the language but not hard-locked; the language gate filters mismatches after recognition.",
  "post-filter":
    "This decoder does not lock to a language — speech in other languages may still be recognized, then filtered by the language gate.",
};

/** Honest one-liner for a provider + profile combination. Never claims
 * decoder locking for providers that cannot enforce it. */
export function capabilityNote(
  provider: string | undefined,
  profile: LanguageProfile,
): string {
  const capability = providerCapability(provider);
  const forced = PROFILE_META[profile].forcedAsrLanguage;
  if (capability === "forced" && forced !== null) {
    return CAPABILITY_NOTES.forced;
  }
  return CAPABILITY_NOTES[capability];
}
