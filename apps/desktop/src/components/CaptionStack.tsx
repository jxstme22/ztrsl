import type { OverlaySnapshot } from "../overlay/model";
import { selectVisibleCaptions } from "../overlay/reducer";
import { renderLabel } from "../sources/labels";
import { fitScaleForLength } from "./captionFit";

type CaptionStackProps = {
  snapshot: OverlaySnapshot;
  preview?: boolean;
  /** "stack" shows every visible lane as a row; "latest" renders only the
      newest caption so each subtitle replaces the previous one. */
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

  const lanes = selectVisibleCaptions(snapshot.captions, snapshot.settings);
  const last = lanes[lanes.length - 1];
  const captions = mode === "latest" && last !== undefined ? [last] : lanes;

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
      data-lanes={captions.length}
      style={style}
      aria-live="polite"
    >
      {captions.map((caption) => {
        const uncertain = caption.certainty?.state === "uncertain";
        const uncertainReasons = caption.certainty?.uncertaintyReasons ?? [];
        const label = renderLabel(
          uncertain
            ? `${caption.source?.captionTag ?? ""}?`
            : (caption.source?.captionTag ?? ""),
          caption.source?.labelStyle ?? "brackets",
        );
        return (
          <article
            className="caption-entry"
            data-status={caption.status}
            data-uncertain={uncertain || undefined}
            data-source={caption.source?.sourceId}
            key={caption.id}
            style={
              {
                "--caption-fit-scale": fitScaleForLength(
                  caption.englishText.length,
                ),
              } as React.CSSProperties
            }
          >
            {label.label !== null && (
              <p
                className="caption-tag"
                data-stacked={label.stacked || undefined}
              >
                {label.label}
              </p>
            )}
            {snapshot.settings.showSource && caption.sourceText !== "" && (
              <p className="caption-source">{caption.sourceText}</p>
            )}
            <p className="caption-english">{caption.englishText}</p>
            <span className="caption-state">
              {uncertain
                ? "Uncertain"
                : caption.status === "provisional"
                  ? "Listening"
                  : "Final"}
            </span>
            {uncertain && uncertainReasons.length > 0 && (
              <span className="caption-uncertain-reasons">
                {uncertainReasons.join(" · ")}
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}
