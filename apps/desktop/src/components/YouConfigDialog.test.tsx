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

describe("YouConfigDialog API credentials", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows only installed local models plus cloud models", () => {
    renderDialog();
    // Installed local model is listed.
    fireEvent.click(screen.getByLabelText(/voice recognition model/i));
    expect(
      screen.getByRole("option", { name: /Local Whisper large-v3-turbo/i }),
    ).toBeInTheDocument();
    // Cloud models are always visible even when not installed locally.
    expect(
      screen.getByRole("option", { name: /NVIDIA Parakeet CTC 1\.1B/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Groq Whisper/i }),
    ).toBeInTheDocument();
    // Uninstalled local models are hidden (only whisper-turbo is installed).
    expect(
      screen.queryByRole("option", { name: /Local Whisper large-v3 \(full\)/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: /NCSpeech FastConformer/i }),
    ).toBeNull();
  });

  it("shows the NVIDIA API key input when an NVIDIA provider is selected", () => {
    window.localStorage.setItem("lst.live.asr-provider", "nvidia-parakeet-1.1b");
    renderDialog();
    const input = screen.getByLabelText(/nvidia api key/i);
    fireEvent.change(input, { target: { value: "nvapi-test" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save & use separate live config/i }),
    );
    expect(window.localStorage.getItem("lst.live.nvidia-api-key")).toBe(
      "nvapi-test",
    );
  });

  it("hides the NVIDIA API key input for local providers", () => {
    window.localStorage.setItem("lst.live.asr-provider", "whisper-turbo");
    window.localStorage.setItem("lst.live.translation-provider", "nllb");
    renderDialog();
    expect(screen.queryByLabelText(/nvidia api key/i)).toBeNull();
  });

  it("no longer offers the auto-reverse checkbox", () => {
    renderDialog();
    expect(
      screen.queryByLabelText(/auto \(reverse of the live pair\)/i),
    ).toBeNull();
  });

  it("no longer offers a start button inside the settings modal", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: /^start$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  });

  it("shows the full live-page settings: quality, VAD, caption mode, segmentation", () => {
    renderDialog();
    expect(
      screen.getByLabelText(/microphone sensitivity/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/quality/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^translation mode$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/caption style/i)).toBeInTheDocument();
  });

  it("persists VAD, caption mode, segmentation and quality on the separate-save path", () => {
    renderDialog();
    const vad = screen.getByLabelText(/microphone sensitivity/i);
    fireEvent.change(vad, { target: { value: "70" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save & use separate live config/i }),
    );
    expect(window.localStorage.getItem("lst.live.vad-sensitivity")).toBe("70");
    expect(window.localStorage.getItem("lst.live.caption-mode")).toBe(
      "streaming",
    );
    expect(window.localStorage.getItem("lst.live.segmentation")).toBe(
      "balanced",
    );
    expect(window.localStorage.getItem("lst.qualityProfile")).not.toBeNull();
  });
});
