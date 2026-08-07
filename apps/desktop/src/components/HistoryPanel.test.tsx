import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type HistoryEntry,
  type HistorySession,
} from "../captions/history";
import { HistoryPanel } from "../captions/HistoryPanel";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "c1",
    text: "Say it",
    sourceText: "sabihin mo",
    sourceLabel: "SRC",
    sourceId: "",
    displayName: "Team",
    color: "",
    audioSource: "",
    timestampMs: 1000,
    uncertain: false,
    startedAtMs: 1000,
    status: "final",
    confidenceCategory: "high",
    provider: "",
    detectedLanguage: "",
    warnings: [],
    preset: "",
    sessionId: "sess-1",
    latencyMs: 0,
    ...overrides,
  };
}

function session(overrides: Partial<HistorySession> = {}): HistorySession {
  return {
    id: "sess-1",
    name: "Session · 08/08 14:30",
    startedAtMs: 1000,
    endedAtMs: null,
    entries: [entry()],
    ...overrides,
  };
}

function renderPanel(
  sessions: HistorySession[],
  handlers: {
    onRenameSession?: (id: string, name: string) => void;
    onDeleteSession?: (id: string) => void;
    onClearSession?: (id: string) => void;
  } = {},
) {
  return render(
    <HistoryPanel
      sessions={sessions}
      currentSessionId={null}
      onRenameSession={handlers.onRenameSession ?? vi.fn()}
      onDeleteSession={handlers.onDeleteSession ?? vi.fn()}
      onClearSession={handlers.onClearSession ?? vi.fn()}
    />,
  );
}

describe("HistoryPanel", () => {
  it("shows the empty state without sessions", () => {
    renderPanel([]);
    expect(
      screen.getByText(/no finished captions yet/i),
    ).toBeInTheDocument();
  });

  it("shows the selected session's transcript (source line hidden by default)", () => {
    renderPanel([session()]);
    expect(screen.getByText("Say it")).toBeInTheDocument();
    expect(screen.queryByText("sabihin mo")).toBeNull();
  });

  it("shows the transcribed input after toggling the option", () => {
    renderPanel([session()]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /transcribed/i }));
    expect(screen.getByText("sabihin mo")).toBeInTheDocument();
    expect(screen.getByText("Say it")).toBeInTheDocument();
  });

  it("does not render a source line when the entry has no source text", () => {
    renderPanel([session({ entries: [entry({ sourceText: "" })] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /transcribed/i }));
    expect(screen.queryByText("sabihin mo")).toBeNull();
  });

  it("shows latency and model badges when the caption carried them", () => {
    renderPanel([
      session({
        entries: [
          entry({ latencyMs: 640, provider: "whisper-turbo + nllb" }),
        ],
      }),
    ]);
    expect(screen.getByText("640 ms")).toBeInTheDocument();
    expect(screen.getByText("whisper-turbo + nllb")).toBeInTheDocument();
  });

  it("filters entries by the search query", () => {
    renderPanel([
      session({
        entries: [entry(), entry({ id: "c2", text: "Rotate B" })],
      }),
    ]);
    const search = screen.getByRole("textbox", { name: /search/i });
    fireEvent.change(search, { target: { value: "rotate" } });
    expect(screen.getByText("Rotate B")).toBeInTheDocument();
    expect(screen.queryByText("Say it")).toBeNull();
  });

  it("renames the selected session", () => {
    const onRenameSession = vi.fn();
    renderPanel([session()], { onRenameSession });
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: /rename session/i });
    fireEvent.change(input, { target: { value: "Round 3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameSession).toHaveBeenCalledWith("sess-1", "Round 3");
  });

  it("deletes the session after a two-step confirm", () => {
    const onDeleteSession = vi.fn();
    renderPanel([session()], { onDeleteSession });
    const deleteButton = screen.getByRole("button", { name: /delete session/i });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);
    expect(onDeleteSession).toHaveBeenCalledWith("sess-1");
  });

  it("copies the translation to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel([session()]);
    fireEvent.click(screen.getByRole("button", { name: /copy translation/i }));
    expect(writeText).toHaveBeenCalledWith("Say it");
  });

  it("clears the session messages from the settings menu", () => {
    const onClearSession = vi.fn();
    renderPanel([session()], { onClearSession });
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /clear session messages/i }));
    expect(onClearSession).toHaveBeenCalledWith("sess-1");
  });

  it("badges the live session in the picker", () => {
    render(
      <HistoryPanel
        sessions={[session(), session({ id: "sess-2", name: "Session · 14:45" })]}
        currentSessionId="sess-2"
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
      />,
    );
    // The toolbar button shows the selected (live) session's name.
    fireEvent.click(screen.getByRole("button", { name: /session · 14:45/i }));
    expect(screen.getAllByLabelText(/live session/i)).toHaveLength(1);
  });
});
