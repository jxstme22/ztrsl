import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SavedProfilesPanel } from "./SavedProfilesPanel";

const PROFILE = {
  id: "p1",
  name: "Valorant Team",
  useCaseId: "valorant",
  sourceOrigin: "virtual_voice_channel",
  captureEndpointId: "cable-out",
  monitorEndpointId: "hp",
  monitoringEnabled: true,
  languageProfile: "tagalog",
  domainPresetId: "valorant",
  qualityProfileId: "balanced",
  vadProfileId: "fast_callouts",
  verifiedAtMs: 1,
  signalResult: "healthy",
  isolationResult: "passed",
};

const AUDIO = {
  catalog: {
    platform: "windows",
    endpoints: [
      { id: "cable-out", friendlyName: "CABLE Output", kind: "capture", state: "active" },
      { id: "hp", friendlyName: "Headphones", kind: "render", state: "active" },
    ],
  },
} as unknown as ReturnType<typeof import("../audio/useAudioMeter").useAudioMeter>;

function liveController() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    state: "stopped",
    snapshot: {},
    lastCaption: null,
    error: null,
    warning: null,
    sessionEndpointId: null,
  } as unknown as ReturnType<typeof import("../live/useLiveTranslation").useLiveTranslation>;
}

describe("SavedProfilesPanel (DS-604)", () => {
  it("starts a saved profile without opening technical settings", () => {
    const storage = new Map<string, string>([
      ["lst.routingProfiles.v1", JSON.stringify([PROFILE])],
    ]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) =>
      storage.get(key) ?? null,
    );
    const live = liveController();
    render(<SavedProfilesPanel audio={AUDIO} live={live} />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(live.start).toHaveBeenCalledWith(
      "cable-out",
      "hp",
      "local",
      true,
      "filipino",
      "en",
      "whisper-turbo",
      "nllb",
    );
    vi.restoreAllMocks();
  });

  it("shows a recovery hint when the capture endpoint is missing", () => {
    const storage = new Map<string, string>([
      [
        "lst.routingProfiles.v1",
        JSON.stringify([{ ...PROFILE, captureEndpointId: "gone" }]),
      ],
    ]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) =>
      storage.get(key) ?? null,
    );
    const live = liveController();
    render(<SavedProfilesPanel audio={AUDIO} live={live} />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
    vi.restoreAllMocks();
  });

  it("renders nothing without saved profiles", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    const live = liveController();
    const { container } = render(<SavedProfilesPanel audio={AUDIO} live={live} />);
    expect(container).toBeEmptyDOMElement();
    vi.restoreAllMocks();
  });
});
