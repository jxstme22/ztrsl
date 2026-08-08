import { useMemo } from "react";
import { Play, TriangleAlert } from "lucide-react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import type { useLiveTranslation } from "../live/useLiveTranslation";

type AudioController = ReturnType<typeof useAudioMeter>;
type LiveController = ReturnType<typeof useLiveTranslation>;
import { useT } from "../features/i18n/store";
import {
  loadRoutingProfiles,
  recoverProfile,
  type RoutingProfile,
} from "../setup/routingProfiles";
import type { SourceMode } from "../live/bridge";

function sourceModeForProfile(profile: RoutingProfile): SourceMode {
  switch (profile.languageProfile) {
    case "mandarin":
    case "chinese_english":
      return "chinese";
    case "english":
      return "english";
    case "indonesian":
      return "indonesian";
    case "vietnamese":
      return "vietnamese";
    case "thai":
      return "thai";
    case "malay":
      return "malay";
    default:
      return "filipino";
  }
}

/**
 * DS-604: start a saved routing profile from the Live page without opening
 * technical settings. Profiles with missing endpoints show a recovery hint
 * instead of disappearing.
 */
export function SavedProfilesPanel({
  audio,
  live,
  sessionIdHint = null,
}: {
  audio: AudioController;
  live: LiveController;
  sessionIdHint?: string | null;
}) {
  const t = useT();
  const profiles = useMemo(() => loadRoutingProfiles(), []);
  const endpoints = audio.catalog?.endpoints ?? [];
  const busy = live.state === "starting" || live.state === "stopping";
  const listening = live.state === "listening";

  if (profiles.length === 0) {
    return null;
  }

  const startProfile = (profile: RoutingProfile) => {
    if (profile.captureEndpointId === null || busy || listening) {
      return;
    }
    const monitorEnabled = profile.monitoringEnabled;
    void live.start(
      profile.captureEndpointId,
      monitorEnabled ? profile.monitorEndpointId : null,
      "local",
      monitorEnabled,
      sourceModeForProfile(profile),
      "en",
      "whisper-turbo",
      "nllb",
      50,
      "balanced",
      [],
      sessionIdHint,
    );
  };

  return (
    <section className="card lst-section-card" aria-labelledby="profiles-title">
      <div className="card-head">
        <h3 className="card-title" id="profiles-title">
          {t("profilesTitle")}
        </h3>
        <span className="lst-model-count pill">{profiles.length}</span>
      </div>
      <ul className="profile-list">
        {profiles.map((profile) => {
          const recovery = recoverProfile(profile, endpoints);
          const capture = endpoints.find(
            (endpoint) => endpoint.id === profile.captureEndpointId,
          );
          const monitor = endpoints.find(
            (endpoint) => endpoint.id === profile.monitorEndpointId,
          );
          return (
            <li key={profile.id} className="profile-row">
              <div className="profile-info">
                <strong>{profile.name}</strong>
                <span>
                  {capture?.friendlyName ?? profile.captureEndpointId ?? "—"}
                  {profile.monitoringEnabled && monitor !== undefined
                    ? ` → ${monitor.friendlyName}`
                    : ""}
                </span>
              </div>
              {recovery.usable ? (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy || listening}
                  onClick={() => {
                    startProfile(profile);
                  }}
                >
                  <Play aria-hidden="true" size={14} />
                  {t("profilesStart")}
                </button>
              ) : (
                <span className="profile-warn" role="status">
                  <TriangleAlert aria-hidden="true" size={14} />
                  {t("profilesNeedAttention")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
