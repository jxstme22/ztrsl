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
        <p className="card-note">{t("aboutIntro")}</p>
      </section>

      <section
        className="card lst-section-card"
        aria-labelledby="about-pages-title"
      >
        <div className="card-head">
          <h3 className="card-title" id="about-pages-title">
            {t("aboutPagesTitle")}
          </h3>
        </div>
        <ul className="about-list">
          <li>
            <strong>{t("aboutPageLiveTitle")}</strong> —{" "}
            {t("aboutPageLiveText")}
          </li>
          <li>
            <strong>{t("aboutPageProfileTitle")}</strong> —{" "}
            {t("aboutPageProfileText")}
          </li>
          <li>
            <strong>{t("aboutPageHistoryTitle")}</strong> —{" "}
            {t("aboutPageHistoryText")}
          </li>
          <li>
            <strong>{t("aboutPageModelsTitle")}</strong> —{" "}
            {t("aboutPageModelsText")}
          </li>
          <li>
            <strong>{t("aboutPageSourcesTitle")}</strong> —{" "}
            {t("aboutPageSourcesText")}
          </li>
          <li>
            <strong>{t("aboutPageSettingsTitle")}</strong> —{" "}
            {t("aboutPageSettingsText")}
          </li>
          <li>
            <strong>{t("aboutPageDiagnosticsTitle")}</strong> —{" "}
            {t("aboutPageDiagnosticsText")}
          </li>
        </ul>
      </section>

      <section
        className="card lst-section-card"
        aria-labelledby="about-models-title"
      >
        <div className="card-head">
          <h3 className="card-title" id="about-models-title">
            {t("aboutModelsTitle")}
          </h3>
        </div>
        <table className="about-table">
          <thead>
            <tr>
              <th></th>
              <th>{t("aboutModelsLocal")}</th>
              <th>{t("aboutModelsCloud")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t("aboutRowPrivacy")}</th>
              <td>{t("aboutPrivacyLocal")}</td>
              <td>{t("aboutPrivacyCloud")}</td>
            </tr>
            <tr>
              <th>{t("aboutRowCost")}</th>
              <td>{t("aboutCostLocal")}</td>
              <td>{t("aboutCostCloud")}</td>
            </tr>
            <tr>
              <th>{t("aboutRowSpeed")}</th>
              <td>{t("aboutSpeedLocal")}</td>
              <td>{t("aboutSpeedCloud")}</td>
            </tr>
            <tr>
              <th>{t("aboutRowOffline")}</th>
              <td>{t("aboutOfflineLocal")}</td>
              <td>{t("aboutOfflineCloud")}</td>
            </tr>
            <tr>
              <th>{t("aboutRowQuality")}</th>
              <td>{t("aboutQualityLocal")}</td>
              <td>{t("aboutQualityCloud")}</td>
            </tr>
            <tr>
              <th>{t("aboutRowSetup")}</th>
              <td>{t("aboutSetupLocal")}</td>
              <td>{t("aboutSetupCloud")}</td>
            </tr>
          </tbody>
        </table>
        <p className="card-note">{t("aboutBestBoth")}</p>
      </section>

      <section
        className="card lst-section-card"
        aria-labelledby="about-specs-title"
      >
        <div className="card-head">
          <h3 className="card-title" id="about-specs-title">
            {t("aboutSpecsTitle")}
          </h3>
        </div>
        <ul className="about-list">
          <li>
            <strong>{t("aboutSpecsMinTitle")}</strong> —{" "}
            {t("aboutSpecsMinText")}
          </li>
          <li>
            <strong>{t("aboutSpecsRecommendedTitle")}</strong> —{" "}
            {t("aboutSpecsRecommendedText")}
          </li>
          <li>
            <strong>{t("aboutSpecsAppleTitle")}</strong> —{" "}
            {t("aboutSpecsAppleText")}
          </li>
          <li>
            <strong>{t("aboutSpecsDiskTitle")}</strong> —{" "}
            {t("aboutSpecsDiskText")}
          </li>
        </ul>
      </section>
    </div>
  );
}
