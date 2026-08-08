import { z } from "zod";

import type { AudioEndpoint } from "../audio/model";
import type { WizardState } from "./wizardState";

/**
 * DS-508/DS-509: reusable routing profiles.
 *
 * A profile captures everything the wizard verified so it can start a
 * session without reopening the wizard. Missing endpoints NEVER delete a
 * profile — they produce a recovery view with replacement actions.
 */

export const routingProfileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(48),
  useCaseId: z.string().min(1),
  sourceOrigin: z.string().min(1),
  captureEndpointId: z.string().max(256).nullable(),
  monitorEndpointId: z.string().max(256).nullable(),
  monitoringEnabled: z.boolean(),
  languageProfile: z.string().min(1),
  domainPresetId: z.string().min(1),
  qualityProfileId: z.string().min(1),
  vadProfileId: z.string().min(1),
  verifiedAtMs: z.number().nonnegative(),
  signalResult: z.string().nullable(),
  isolationResult: z.string().nullable(),
});

export type RoutingProfile = z.infer<typeof routingProfileSchema>;

const PROFILES_KEY = "lst.routingProfiles.v1";

export function profileFromWizard(
  state: WizardState,
  name: string,
  meta: {
    id: string;
    sourceOrigin: string;
    domainPresetId: string;
    qualityProfileId: string;
    vadProfileId: string;
  },
): RoutingProfile {
  return {
    id: meta.id,
    name,
    useCaseId: state.useCaseId ?? "other",
    sourceOrigin: meta.sourceOrigin,
    captureEndpointId: state.captureEndpointId,
    monitorEndpointId: state.monitorEndpointId,
    monitoringEnabled: state.monitoringEnabled,
    languageProfile: "auto",
    domainPresetId: meta.domainPresetId,
    qualityProfileId: meta.qualityProfileId,
    vadProfileId: meta.vadProfileId,
    verifiedAtMs: Date.now(),
    signalResult: state.signalResult,
    isolationResult: state.isolationResult,
  };
}

export function loadRoutingProfiles(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): RoutingProfile[] {
  const serialized = storage.getItem(PROFILES_KEY);
  if (serialized === null) {
    return [];
  }
  try {
    const parsed = z
      .array(routingProfileSchema)
      .safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveRoutingProfiles(
  profiles: RoutingProfile[],
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function deleteRoutingProfile(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): RoutingProfile[] {
  const next = loadRoutingProfiles(storage).filter(
    (profile) => profile.id !== id,
  );
  saveRoutingProfiles(next, storage);
  return next;
}

export type ProfileRecovery = {
  profile: RoutingProfile;
  /** Endpoint ids referenced by the profile that are no longer present. */
  missing: string[];
  /** True when every referenced endpoint exists and is active. */
  usable: boolean;
};

export function recoverProfile(
  profile: RoutingProfile,
  endpoints: AudioEndpoint[],
): ProfileRecovery {
  const referenced = [
    profile.captureEndpointId,
    profile.monitorEndpointId,
  ].filter((id): id is string => id !== null && id !== "");
  const missing = referenced.filter(
    (id) => !endpoints.some((endpoint) => endpoint.id === id),
  );
  const inactive = referenced.filter((id) => {
    const endpoint = endpoints.find((candidate) => candidate.id === id);
    return endpoint !== undefined && endpoint.state !== "active";
  });
  const problems = [...missing, ...inactive];
  return {
    profile,
    missing: problems,
    usable: problems.length === 0,
  };
}

/** DS-509: replace an endpoint id without recreating the profile. */
export function replaceProfileEndpoint(
  profile: RoutingProfile,
  oldId: string,
  newId: string,
): RoutingProfile {
  return {
    ...profile,
    captureEndpointId:
      profile.captureEndpointId === oldId ? newId : profile.captureEndpointId,
    monitorEndpointId:
      profile.monitorEndpointId === oldId ? newId : profile.monitorEndpointId,
  };
}

/** DS-509: reset only this profile (endpoints cleared, identity kept). */
export function resetProfile(profile: RoutingProfile): RoutingProfile {
  return {
    ...profile,
    captureEndpointId: null,
    monitorEndpointId: null,
    monitoringEnabled: false,
    signalResult: null,
    isolationResult: null,
  };
}
