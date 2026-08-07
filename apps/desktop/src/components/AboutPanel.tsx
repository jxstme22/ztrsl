import { useT } from "../features/i18n/store";

/**
 * About page: project overview, a plain-language guide to every page,
 * local-vs-cloud model comparison, and hardware recommendations for
 * running local models. Static content — no live state.
 */
export function AboutPanel({ version = "0.8.0" }: { version?: string }) {
  const t = useT();
  return (
    <div className="page-stack">
      <section className="card lst-section-card" aria-labelledby="about-title">
        <div className="card-head">
          <h2 className="card-title" id="about-title">
            {t("navAbout")}
          </h2>
          <span className="lst-model-count pill">v{version}</span>
        </div>
        <p className="card-note">
          yTSRL is a privacy-first accessibility companion: it listens to voice
          chat on your computer and shows near-live English captions for what
          your teammates say. Everything runs on your own machine — nothing
          you say is uploaded unless you choose a cloud provider.
        </p>
      </section>

      <section className="card lst-section-card" aria-labelledby="about-pages-title">
        <div className="card-head">
          <h3 className="card-title" id="about-pages-title">
            The pages, simply explained
          </h3>
        </div>
        <ul className="about-list">
          <li>
            <strong>Live</strong> — the main screen. Pick an audio channel, a
            speech-to-text model, and a translation provider, then press Start.
            Captions appear on the overlay above your game.
          </li>
          <li>
            <strong>Profile</strong> — saved setups. Run the guided setup once
            (or edit settings manually) and every profile is one click to
            start later. This is the page you want if you play on different
            machines or with different friends.
          </li>
          <li>
            <strong>History</strong> — a transcript of everything that has been
            translated this session, with export buttons for saving it.
          </li>
          <li>
            <strong>Models</strong> — download and manage the local AI models
            used for speech recognition and translation, with license and
            checksum details.
          </li>
          <li>
            <strong>Sources</strong> — advanced multi-channel setup: give each
            voice channel (team chat, Discord, a meeting) its own color, tag,
            and language profile.
          </li>
          <li>
            <strong>Settings</strong> — appearance (dark/light), overlay
            behavior, hotkeys, and language.
          </li>
          <li>
            <strong>Diagnostics</strong> — latency and health graphs for the
            audio, speech, and translation pipeline when something feels slow.
          </li>
        </ul>
      </section>

      <section className="card lst-section-card" aria-labelledby="about-models-title">
        <div className="card-head">
          <h3 className="card-title" id="about-models-title">
            Local models vs cloud models
          </h3>
        </div>
        <table className="about-table">
          <thead>
            <tr>
              <th></th>
              <th>Local (on your PC)</th>
              <th>Cloud (API)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Privacy</th>
              <td>Audio never leaves your machine</td>
              <td>Speech is sent to the provider</td>
            </tr>
            <tr>
              <th>Cost</th>
              <td>Free, after the one-time model download</td>
              <td>Usually free tiers, then pay-per-use</td>
            </tr>
            <tr>
              <th>Speed</th>
              <td>Great on a good GPU; slower on CPU</td>
              <td>Fast, needs a stable internet connection</td>
            </tr>
            <tr>
              <th>Offline</th>
              <td>Works with no internet</td>
              <td>Does not work offline</td>
            </tr>
            <tr>
              <th>Quality</th>
              <td>Very good (Whisper family)</td>
              <td>State-of-the-art (NVIDIA Parakeet, Groq Whisper)</td>
            </tr>
            <tr>
              <th>Setup</th>
              <td>Download models once, then just click Start</td>
              <td>Create an API key and paste it in Live</td>
            </tr>
          </tbody>
        </table>
        <p className="card-note">
          Best of both: use local Whisper + NLLB for privacy, and switch to
          cloud (NVIDIA Parakeet + Riva, or Groq) when you want maximum
          accuracy or when your machine cannot keep up.
        </p>
      </section>

      <section className="card lst-section-card" aria-labelledby="about-specs-title">
        <div className="card-head">
          <h3 className="card-title" id="about-specs-title">
            Recommended specs for local models
          </h3>
        </div>
        <ul className="about-list">
          <li>
            <strong>Minimum (everything works, slower)</strong> — 4-core CPU,
            16 GB RAM. Whisper runs on CPU with a bit of delay; NLLB
            translation still feels responsive.
          </li>
          <li>
            <strong>Recommended (best latency)</strong> — NVIDIA GPU with 8 GB
            VRAM or more (GTX 2060 / RTX 3060 class and up). Speech is
            recognized within about a second of a sentence ending.
          </li>
          <li>
            <strong>macOS / Apple Silicon</strong> — M1 with 16 GB RAM works
            well; M-series GPU is used automatically by the MLX Whisper
            model.
          </li>
          <li>
            <strong>Disk space</strong> — about 3 GB for the standard Whisper
            + NLLB pair (larger Whisper model: ~6 GB total). Downloads happen
            once in the Models page.
          </li>
        </ul>
      </section>
    </div>
  );
}
