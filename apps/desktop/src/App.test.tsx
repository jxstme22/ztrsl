import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

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
      screen.getByRole("heading", { name: "Translation console" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Private by default")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No cloud processing, recording, transcript history, telemetry, or game-process access.",
      ),
    ).toBeInTheDocument();
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

  it("requires both voice input and monitoring output for live translation", async () => {
    render(<App />);

    const start = screen.getByRole("button", { name: "Start listening" });
    const voiceInput = screen.getByRole("combobox", {
      name: /Voice-chat channel/,
    });
    const monitoringOutput = screen.getByRole("combobox", {
      name: "Monitoring output",
    });
    await within(voiceInput).findByRole("option", {
      name: "Generated voice signal (macOS simulator)",
    });
    await within(monitoringOutput).findByRole("option", {
      name: "Silent test sink (macOS simulator)",
    });
    expect(start).toBeDisabled();

    fireEvent.change(voiceInput, {
      target: { value: "synthetic://phase-2-meter" },
    });
    expect(start).toBeDisabled();
    fireEvent.change(monitoringOutput, {
      target: { value: "synthetic://phase-3-headphones" },
    });
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
    expect(
      await screen.findByRole("button", { name: "Start listening" }),
    ).toBeEnabled();
  });

  it("requires explicit endpoint selection before starting the meter", async () => {
    render(<App />);

    const start = screen.getByRole("button", { name: "Start meter" });
    expect(start).toBeDisabled();
    const selector = screen.getByRole("combobox", {
      name: "Capture endpoint",
    });
    await within(selector).findByRole("option", {
      name: "Generated voice signal (macOS simulator)",
    });
    fireEvent.change(selector, {
      target: { value: "synthetic://phase-2-meter" },
    });
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
    fireEvent.click(screen.getByText("Advanced diagnostics"));

    const start = screen.getByRole("button", {
      name: "Run pipeline simulator",
    });
    expect(start).toBeDisabled();
    const capture = screen.getByRole("combobox", { name: "Generated input" });
    const playback = screen.getByRole("combobox", {
      name: "Silent output sink",
    });
    await within(capture).findByRole("option", {
      name: "Generated voice signal (macOS simulator)",
    });
    await within(playback).findByRole("option", {
      name: "Silent test sink (macOS simulator)",
    });
    fireEvent.change(capture, {
      target: { value: "synthetic://phase-2-meter" },
    });
    fireEvent.change(playback, {
      target: { value: "synthetic://phase-3-headphones" },
    });
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => {
      expect(screen.getByText("Routing active")).toBeInTheDocument();
    });
  });

  it("sends fake binary audio through the sidecar lifecycle into the overlay", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Advanced diagnostics"));
    fireEvent.click(screen.getByRole("button", { name: "Start fake sidecar" }));
    const run = await screen.findByRole("button", {
      name: "Send fake audio end to end",
    });
    fireEvent.click(run);

    await waitFor(() => {
      expect(
        screen.getByText("Let's rotate to B—they're already on A."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("18 ms fake latency")).toBeInTheDocument();
  });

  it("keeps clip inference honestly labeled in browser demo mode", async () => {
    render(<App />);

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
