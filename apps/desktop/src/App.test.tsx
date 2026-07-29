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
      screen.getByRole("heading", { name: "Caption overlay" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Local-only prototype")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No recording, playback, history, telemetry, or game access.",
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
      screen.getByRole("button", { name: "Send fake caption" }),
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
      name: "Synthetic voice meter (development)",
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

    fireEvent.click(screen.getByRole("button", { name: "Send fake caption" }));
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

    const start = screen.getByRole("button", {
      name: "Start routing test",
    });
    expect(start).toBeDisabled();
    const capture = screen.getByRole("combobox", { name: "Capture source" });
    const playback = screen.getByRole("combobox", {
      name: "Monitoring output",
    });
    await within(capture).findByRole("option", {
      name: "Synthetic voice meter (development)",
    });
    await within(playback).findByRole("option", {
      name: "Synthetic headphones (development)",
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
});
