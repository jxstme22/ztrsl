import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

async function chooseOption(combobox: HTMLElement, optionName: string) {
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
}

describe("control window", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the inactive and local-only safety scope", () => {
    render(<App />);

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Diagnostics" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText("Capture meter only · no playback · no recording"),
    ).toBeInTheDocument();
  });

  it("shows an actionable empty state", () => {
    render(<App />);

    expect(screen.getByText("No captions yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview sample caption" }),
    ).toBeEnabled();
  });

  it("starts live translation once a voice channel is chosen with monitor off by default", async () => {
    render(<App />);

    const start = screen.getByRole("button", { name: "Start listening" });
    const voiceInput = screen.getByRole("combobox", {
      name: /Voice-chat channel/,
    });
    expect(start).toBeDisabled();

    await chooseOption(voiceInput, "Generated voice signal (macOS simulator)");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start listening" }),
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect(
      await screen.findByRole("button", { name: "Stop listening" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    // Stop asks for confirmation: end the session (transcript is kept).
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));
    expect(
      await screen.findByRole("button", { name: "Start listening" }),
    ).toBeEnabled();
  });

  it("requires a monitoring output only when monitor is on", async () => {
    render(<App />);

    const voiceInput = screen.getByRole("combobox", {
      name: /Voice-chat channel/,
    });
    await chooseOption(voiceInput, "Generated voice signal (macOS simulator)");

    const monitorToggle = screen.getByRole("checkbox", {
      name: /Monitor captured audio/,
    });
    fireEvent.click(monitorToggle);

    const monitoringOutput = await screen.findByRole("combobox", {
      name: "Monitoring output",
    });
    const start = screen.getByRole("button", { name: "Start listening" });
    expect(start).toBeDisabled();

    await chooseOption(monitoringOutput, "Silent test sink (macOS simulator)");
    await waitFor(() => {
      expect(start).toBeEnabled();
    });
  });

  it("requires explicit endpoint selection before starting the meter", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));

    const start = screen.getByRole("button", { name: "Start meter" });
    expect(start).toBeDisabled();
    const selector = screen.getByRole("combobox", {
      name: "Capture endpoint",
    });
    await chooseOption(selector, "Generated voice signal (macOS simulator)");
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Stop meter" }),
      ).toBeInTheDocument();
    });
  });

  it("moves a fake caption from provisional to final", () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Preview sample caption" }),
    );
    expect(screen.getByText("Let's rotate to B…")).toBeInTheDocument();
    expect(screen.getByText("Listening")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_300);
    });

    expect(
      screen.getByText("Let's rotate to B—they're already on A."),
    ).toBeInTheDocument();
    expect(screen.getByText("Final")).toBeInTheDocument();
  });

  it("runs the synthetic monitoring route only after both endpoints are chosen", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));

    const start = screen.getByRole("button", {
      name: "Run pipeline simulator",
    });
    expect(start).toBeDisabled();
    const capture = screen.getByRole("combobox", { name: "Generated input" });
    const playback = screen.getByRole("combobox", {
      name: "Silent output sink",
    });
    await chooseOption(capture, "Generated voice signal (macOS simulator)");
    await chooseOption(playback, "Silent test sink (macOS simulator)");
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => {
      expect(screen.getByText("Routing active")).toBeInTheDocument();
    });
  });

  it("sends fake binary audio through the sidecar lifecycle into the overlay", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Start fake sidecar" }));
    const run = await screen.findByRole("button", {
      name: "Send fake audio end to end",
    });
    fireEvent.click(run);

    await waitFor(() => {
      expect(screen.getByText("18 ms fake latency")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => {
      expect(
        screen.getByText("Let's rotate to B—they're already on A."),
      ).toBeInTheDocument();
    });
  });

  it("keeps clip inference honestly labeled in browser demo mode", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: /Drop an MP4, MOV, MKV, or audio file/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Analyze clip" }));

    expect(
      await screen.findByText(
        "[demo translation — local MT model not installed]",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Demo · demo-asr\+demo-mt/)).toBeInTheDocument();
  });
});
