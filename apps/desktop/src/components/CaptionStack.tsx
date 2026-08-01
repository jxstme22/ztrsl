import type { OverlaySnapshot } from "../overlay/model";

type CaptionStackProps = {
  snapshot: OverlaySnapshot;
  preview?: boolean;
};

export function CaptionStack({ snapshot, preview = false }: CaptionStackProps) {
  const style = {
    "--caption-scale": snapshot.settings.fontScale,
    "--caption-opacity": snapshot.settings.backgroundOpacity,
  } as React.CSSProperties;

  if (snapshot.captions.length === 0) {
    return preview ? (
      <div className="caption-empty">
        <strong>No captions yet</strong>
        <span>Send a fake line to test the full caption lifecycle.</span>
      </div>
    ) : null;
  }

  return (
    <div className="caption-stack" style={style} aria-live="polite">
      {snapshot.captions.map((caption) => (
        <article
          className="caption-entry"
          data-status={caption.status}
          key={caption.id}
        >
          {snapshot.settings.showSource && (
            <p className="caption-source">{caption.sourceText}</p>
          )}
          <p className="caption-english">{caption.englishText}</p>
          <span className="caption-state">
            {caption.status === "provisional" ? "Listening" : "Final"}
          </span>
        </article>
      ))}
    </div>
  );
}
