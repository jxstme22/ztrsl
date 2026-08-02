import type { OverlaySnapshot } from "../overlay/model";
import { fitScaleForLength } from "./captionFit";

type CaptionStackProps = {
  snapshot: OverlaySnapshot;
  preview?: boolean;
  /** "stack" shows every caption as a row; "latest" renders only the newest
      caption so each subtitle replaces the previous one. */
  mode?: "stack" | "latest";
};

export function CaptionStack({
  snapshot,
  preview = false,
  mode = "stack",
}: CaptionStackProps) {
  const style = {
    "--caption-scale": snapshot.settings.fontScale,
    "--caption-opacity": snapshot.settings.backgroundOpacity,
  } as React.CSSProperties;

  const last = snapshot.captions[snapshot.captions.length - 1];
  const captions =
    mode === "latest" && last !== undefined ? [last] : snapshot.captions;

  if (captions.length === 0) {
    return preview ? (
      <div className="caption-empty">
        <strong>No captions yet</strong>
        <span>Send a fake line to test the full caption lifecycle.</span>
      </div>
    ) : null;
  }

  return (
    <div
      className="caption-stack"
      data-mode={mode}
      style={style}
      aria-live="polite"
    >
      {captions.map((caption) => (
        <article
          className="caption-entry"
          data-status={caption.status}
          key={caption.id}
          style={
            {
              "--caption-fit-scale": fitScaleForLength(
                caption.englishText.length,
              ),
            } as React.CSSProperties
          }
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
