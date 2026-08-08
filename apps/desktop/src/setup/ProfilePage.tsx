import { useT } from "../features/i18n/store";
import type { useAudioMeter } from "../audio/useAudioMeter";
import type { useLiveTranslation } from "../live/useLiveTranslation";
import { SavedProfilesPanel } from "../components/SavedProfilesPanel";
import { SetupWizard } from "./SetupWizard";

type AudioController = ReturnType<typeof useAudioMeter>;
type LiveController = ReturnType<typeof useLiveTranslation>;

/**
 * Profile page: saved routing profiles (one-click start) plus the guided
 * setup wizard that creates them. Everything that configures a profile
 * lives on this page; the Live page stays focused on the running session.
 */
export function ProfilePage({
  audio,
  live,
  sessionIdHint = null,
}: {
  audio: AudioController;
  live: LiveController;
  sessionIdHint?: string | null;
}) {
  const t = useT();
  return (
    <div className="page-stack">
      <section
        className="card lst-section-card"
        aria-labelledby="profile-title"
      >
        <div className="card-head">
          <h2 className="card-title" id="profile-title">
            {t("navSetup")}
          </h2>
        </div>
        <p className="card-note">{t("profileIntro")}</p>
      </section>
      <SavedProfilesPanel
        audio={audio}
        live={live}
        sessionIdHint={sessionIdHint}
      />
      <SetupWizard audio={audio} />
    </div>
  );
}
