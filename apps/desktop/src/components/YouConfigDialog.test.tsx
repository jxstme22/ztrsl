import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { YouConfigDialog } from "./YouConfigDialog";

function renderDialog(
  overrides: {
    onSaved?: (config: unknown) => void;
    onClose?: () => void;
  } = {},
) {
  return render(
    <YouConfigDialog
      endpoints={[
        {
          id: "mic-1",
          friendlyName: "Built-in Microphone",
          kind: "capture",
          state: "active",
          defaultRoles: {
            console: true,
            multimedia: true,
            communications: true,
          },
          nativeFormat: { sampleRate: 48000, channels: 1 },
          isSynthetic: false,
        },
        {
          id: "out-1",
          friendlyName: "Headphones",
          kind: "render",
          state: "active",
          defaultRoles: {
            console: true,
            multimedia: true,
            communications: true,
          },
          nativeFormat: { sampleRate: 48000, channels: 2 },
          isSynthetic: false,
        },
      ]}
      installedModelIds={
        new Set(["whisper-large-v3-turbo", "nllb-200-distilled-600M-ct2-int8"])
      }
      onClose={overrides.onClose ?? vi.fn()}
      onSaved={overrides.onSaved ?? vi.fn()}
      onStartSeparatedLive={vi.fn()}
      onStopSeparatedLive={vi.fn()}
    />,
  );
}

describe("YouConfigDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("plain Save keeps the live page config untouched", () => {
    window.localStorage.setItem("lst.live.translation-provider", "madlad");
    const onSaved = vi.fn();
    renderDialog({ onSaved });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // The live section must NOT be applied to the live page keys.
    expect(window.localStorage.getItem("lst.live.translation-provider")).toBe(
      "madlad",
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("Save & use separate live config applies the live section", () => {
    window.localStorage.setItem("lst.live.translation-provider", "madlad");
    renderDialog();
    // Pick a different translation model in the Live section.
    fireEvent.click(screen.getByLabelText(/translation model/i));
    fireEvent.click(screen.getByRole("option", { name: /nllb/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /save & use separate live config/i }),
    );
    expect(window.localStorage.getItem("lst.live.translation-provider")).toBe(
      "nllb",
    );
  });

  it("shows the live-section note so users know it is separate", () => {
    renderDialog();
    expect(screen.getByText(/only apply when you press/i)).toBeInTheDocument();
  });
});

describe("YouConfigDialog separated live controls", () => {
  it("shows the separated-live start button and starts it", () => {
    const onStart = vi.fn().mockResolvedValue(null);
    render(
      <YouConfigDialog
        endpoints={[
          {
            id: "mic-1",
            friendlyName: "Built-in Microphone",
            kind: "capture",
            state: "active",
            defaultRoles: {
              console: true,
              multimedia: true,
              communications: true,
            },
            nativeFormat: { sampleRate: 48000, channels: 1 },
            isSynthetic: false,
          },
        ]}
        installedModelIds={new Set()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        separatedState="idle"
        separatedError={null}
        onStartSeparatedLive={onStart}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("shows Stop while the separated live is listening", () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    render(
      <YouConfigDialog
        endpoints={[]}
        installedModelIds={new Set()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        separatedState="listening"
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={onStop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
