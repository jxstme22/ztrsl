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
}: {
  audio: AudioController;
  live: LiveController;
}) {
  const t = useT();
  return (
    <div className="page-stack">
      <section className="card lst-section-card" aria-labelledby="profile-title">
        <div className="card-head">
          <h2 className="card-title" id="profile-title">
            {t("navSetup")}
          </h2>
        </div>
        <p className="card-note">
          Saved profiles remember which audio channel to capture, how it is
          monitored, and how it should be translated. Start one from the list
          below, or create a new one with the guided setup.
        </p>
      </section>
      <SavedProfilesPanel audio={audio} live={live} />
      <SetupWizard audio={audio} />
    </div>
  );
}
