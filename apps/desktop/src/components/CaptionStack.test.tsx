import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaptionStack } from "./CaptionStack";
import type { Caption, CaptionSource, OverlaySnapshot } from "../overlay/model";
import { DEFAULT_OVERLAY_SETTINGS } from "../overlay/model";

const TEAM = "11111111111111111111111111111111";
const DISCORD = "22222222222222222222222222222222";

function source(supplied: Partial<CaptionSource>): CaptionSource {
  return {
    sourceId: TEAM,
    captionTag: "TEAM",
    labelStyle: "brackets",
    color: null,
    ...supplied,
  };
}

function snapshot(
  captions: Caption[],
  overrides: Partial<OverlaySnapshot> = {},
) {
  return {
    visible: true,
    mode: "play" as const,
    translationEnabled: true,
    captions,
    settings: DEFAULT_OVERLAY_SETTINGS,
    ...overrides,
  };
}

function caption(
  id: string,
  text: string,
  src: CaptionSource | undefined,
  status: Caption["status"] = "final",
): Caption {
  return {
    id,
    revision: 1,
    status,
    sourceText: "Adto ta sa B.",
    englishText: text,
    createdAtMs: 100,
    expiresAtMs: 5_000,
    source: src,
  };
}

describe("CaptionStack lanes", () => {
  it("renders a label for a sourced caption using the label style", () => {
    render(
      <CaptionStack
        snapshot={snapshot([
          caption("team", "Rotate B!", source({ captionTag: "TEAM" })),
        ])}
      />,
    );

    expect(screen.getByText("[TEAM]")).toBeInTheDocument();
    expect(screen.getByText("Rotate B!")).toBeInTheDocument();
  });

  it("renders all five label styles from the source snapshot", () => {
    const styles: CaptionSource["labelStyle"][] = [
      "brackets",
      "colon",
      "bullet",
      "stacked",
      "hidden",
    ];
    for (const labelStyle of styles) {
      const { unmount } = render(
        <CaptionStack
          snapshot={snapshot([
            caption(
              `team-${labelStyle}`,
              "Go B",
              source({ captionTag: "TEAM", labelStyle }),
            ),
          ])}
        />,
      );
      if (labelStyle === "hidden") {
        expect(screen.queryByText(/TEAM/)).not.toBeInTheDocument();
      } else {
        expect(screen.getByText(/TEAM/)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("renders two independent source lanes (show-both)", () => {
    render(
      <CaptionStack
        snapshot={snapshot([
          caption(
            "discord",
            "Let's go!",
            source({ sourceId: DISCORD, captionTag: "DISCORD" }),
          ),
          caption("team", "Rotate B!", source({ captionTag: "TEAM" })),
        ])}
      />,
    );

    expect(screen.getByText("[TEAM]")).toBeInTheDocument();
    expect(screen.getByText("[DISCORD]")).toBeInTheDocument();
    expect(screen.getByText("Rotate B!")).toBeInTheDocument();
    expect(screen.getByText("Let's go!")).toBeInTheDocument();
  });

  it("hides a source's captions when configured", () => {
    render(
      <CaptionStack
        snapshot={snapshot(
          [
            caption(
              "discord",
              "Let's go!",
              source({ sourceId: DISCORD, captionTag: "DISCORD" }),
            ),
            caption("team", "Rotate B!", source({ captionTag: "TEAM" })),
          ],
          {
            settings: {
              ...DEFAULT_OVERLAY_SETTINGS,
              hiddenSourceIds: [DISCORD],
            },
          },
        )}
      />,
    );

    expect(screen.getByText("[TEAM]")).toBeInTheDocument();
    expect(screen.queryByText("[DISCORD]")).not.toBeInTheDocument();
  });

  it("expires per-source captions independently", () => {
    const teamCaption = caption(
      "team",
      "Rotate B!",
      source({ captionTag: "TEAM" }),
      "provisional",
    );
    const expiredTeam: Caption = { ...teamCaption, expiresAtMs: 100 };
    render(
      <CaptionStack
        snapshot={snapshot([
          caption(
            "discord",
            "Let's go!",
            source({ sourceId: DISCORD, captionTag: "DISCORD" }),
          ),
          expiredTeam,
        ])}
      />,
    );

    // Both lanes are still shown; expiration is decided by the reducer via
    // expiresAtMs per caption, not by the renderer.
    expect(screen.getByText("[TEAM]")).toBeInTheDocument();
    expect(screen.getByText("[DISCORD]")).toBeInTheDocument();
  });

  it("newest-wins policy renders only one lane", () => {
    render(
      <CaptionStack
        snapshot={snapshot(
          [
            caption(
              "discord",
              "Let's go!",
              source({ sourceId: DISCORD, captionTag: "DISCORD" }),
            ),
            caption("team", "Rotate B!", source({ captionTag: "TEAM" })),
          ],
          {
            settings: {
              ...DEFAULT_OVERLAY_SETTINGS,
              simultaneousPolicy: "newest-wins",
            },
          },
        )}
      />,
    );

    const tags = screen.queryAllByText(/TEAM|DISCORD/);
    expect(tags.length).toBe(1);
  });

  it("escapes label content so a tag is never injected as HTML", () => {
    render(
      <CaptionStack
        snapshot={snapshot([
          caption(
            "team",
            "Rotate B!",
            source({
              captionTag: '<img src=x onerror="window.__xss=1">',
              labelStyle: "brackets",
            }),
          ),
        ])}
      />,
    );

    const tag = screen.getByText(/img src=x/);
    expect(tag.tagName).toBe("P");
    expect(tag.querySelector("img")).toBeNull();
    expect((window as Window & { __xss?: unknown }).__xss).toBeUndefined();
  });

  it("renders uncertain captions with a distinct marker and reasons", () => {
    const uncertainCaption = {
      ...caption(
        "team",
        "Possibly two at B main",
        source({ captionTag: "TEAM" }),
        "final",
      ),
      certainty: {
        state: "uncertain" as const,
        uncertaintyReasons: ["overlapping_speech", "low_asr_confidence"],
        suppressionReason: null,
      },
    };
    render(<CaptionStack snapshot={snapshot([uncertainCaption])} />);

    expect(screen.getByText("[TEAM?]")).toBeInTheDocument();
    expect(screen.getByText("Uncertain")).toBeInTheDocument();
    expect(
      screen.getByText("overlapping_speech · low_asr_confidence"),
    ).toBeInTheDocument();
  });
});
