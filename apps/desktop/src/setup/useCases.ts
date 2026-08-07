/**
 * DS-502/DS-504: use-case selection catalog + routing instructions.
 *
 * Selecting a use case only LOADS suggestions (source name, preset, origin,
 * VAD profile, monitoring default) and routing instructions — it never
 * changes any audio device. Data-only: the wizard component consumes this.
 */

export type UseCaseId = "valorant" | "discord" | "meeting" | "browser_call" | "other";

export type UseCase = {
  id: UseCaseId;
  displayName: string;
  suggestedSourceName: string;
  suggestedPresetId: string;
  suggestedSourceOrigin: string;
  suggestedVadProfileId: string;
  defaultMonitoring: boolean;
};

export const USE_CASES: Record<UseCaseId, UseCase> = {
  valorant: {
    id: "valorant",
    displayName: "VALORANT",
    suggestedSourceName: "Valorant Team",
    suggestedPresetId: "valorant",
    suggestedSourceOrigin: "virtual_voice_channel",
    suggestedVadProfileId: "fast_callouts",
    defaultMonitoring: true,
  },
  discord: {
    id: "discord",
    displayName: "Discord",
    suggestedSourceName: "Discord Call",
    suggestedPresetId: "discord",
    suggestedSourceOrigin: "virtual_voice_channel",
    suggestedVadProfileId: "natural_conversation",
    defaultMonitoring: true,
  },
  meeting: {
    id: "meeting",
    displayName: "Meeting application",
    suggestedSourceName: "Meeting",
    suggestedPresetId: "meeting",
    suggestedSourceOrigin: "virtual_voice_channel",
    suggestedVadProfileId: "meeting",
    defaultMonitoring: true,
  },
  browser_call: {
    id: "browser_call",
    displayName: "Browser call",
    suggestedSourceName: "Browser Call",
    suggestedPresetId: "general",
    suggestedSourceOrigin: "application_audio",
    suggestedVadProfileId: "natural_conversation",
    defaultMonitoring: true,
  },
  other: {
    id: "other",
    displayName: "Other application",
    suggestedSourceName: "Audio Source",
    suggestedPresetId: "general",
    suggestedSourceOrigin: "application_audio",
    suggestedVadProfileId: "natural_conversation",
    defaultMonitoring: false,
  },
};

export type RoutingStep = { from: string; to: string };

/** Routing instructions adapt to the use case; the app never pretends it
 * changed external application settings. */
export const ROUTING_STEPS: Record<UseCaseId, RoutingStep[]> = {
  valorant: [
    { from: "Game sound output", to: "Headphones" },
    { from: "Voice chat output", to: "CABLE Input" },
    { from: "yTRSL capture source", to: "CABLE Output" },
    { from: "yTRSL monitor output", to: "Headphones" },
  ],
  discord: [
    { from: "Discord output", to: "CABLE Input" },
    { from: "yTRSL capture source", to: "CABLE Output" },
    { from: "yTRSL monitor output", to: "Headphones" },
  ],
  meeting: [
    { from: "Meeting app output", to: "CABLE Input" },
    { from: "yTRSL capture source", to: "CABLE Output" },
    { from: "yTRSL monitor output", to: "Headphones" },
  ],
  browser_call: [
    { from: "Browser output", to: "CABLE Input" },
    { from: "yTRSL capture source", to: "CABLE Output" },
    { from: "yTRSL monitor output", to: "Headphones" },
  ],
  other: [
    { from: "Application output", to: "CABLE Input" },
    { from: "yTRSL capture source", to: "CABLE Output" },
    { from: "yTRSL monitor output", to: "Headphones" },
  ],
};

/** Critical copy: the two names that must never be confused. */
export const CRITICAL_ROUTING_COPY =
  "Select CABLE Input inside the application. Select CABLE Output as the recording source inside yTRSL.";
