import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type HistoryEntry, type HistorySession } from "../captions/history";
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
    fromSelf: false,
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
    onNewSession?: () => void;
    onRenameSession?: (id: string, name: string) => void;
    onDeleteSession?: (id: string) => void;
    onClearSession?: (id: string) => void;
    separatedState?: "idle" | "starting" | "listening" | "stopping" | "error";
    onStartSeparated?: () => Promise<string | null>;
    onStopSeparated?: () => Promise<void>;
  } = {},
) {
  return render(
    <HistoryPanel
      sessions={sessions}
      currentSessionId={null}
      onNewSession={handlers.onNewSession ?? vi.fn()}
      onRenameSession={handlers.onRenameSession ?? vi.fn()}
      onDeleteSession={handlers.onDeleteSession ?? vi.fn()}
      onClearSession={handlers.onClearSession ?? vi.fn()}
      micEnabled={false}
      micConfigured={true}
      liveRunning={true}
      onToggleMic={vi.fn()}
      onSendChat={vi.fn()}
      onOpenYouConfig={vi.fn()}
      separatedState={handlers.separatedState ?? "idle"}
      onStartSeparated={handlers.onStartSeparated ?? vi.fn()}
      onStopSeparated={handlers.onStopSeparated ?? vi.fn()}
    />,
  );
}

describe("HistoryPanel", () => {
  it("shows the empty state without sessions", () => {
    renderPanel([]);
    expect(screen.getByText(/no finished captions yet/i)).toBeInTheDocument();
  });

  it("shows the selected session's transcript (source line hidden by default)", () => {
    renderPanel([session()]);
    expect(screen.getByText("Say it")).toBeInTheDocument();
    expect(screen.queryByText("sabihin mo")).toBeNull();
  });

  it("shows the transcribed input after toggling the option", () => {
    renderPanel([session()]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: /transcribed/i }),
    );
    expect(screen.getByText("sabihin mo")).toBeInTheDocument();
    expect(screen.getByText("Say it")).toBeInTheDocument();
  });

  it("does not render a source line when the entry has no source text", () => {
    renderPanel([session({ entries: [entry({ sourceText: "" })] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: /transcribed/i }),
    );
    expect(screen.queryByText("sabihin mo")).toBeNull();
  });

  it("renders a per-caption bubble with the copy button", () => {
    renderPanel([
      session({
        entries: [entry({ id: "c1", text: "Say it", latencyMs: 640 })],
      }),
    ]);
    expect(screen.getByText("Say it")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy translation/i }),
    ).toBeInTheDocument();
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
    const deleteButton = screen.getByRole("button", {
      name: /delete session/i,
    });
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
    fireEvent.click(
      screen.getByRole("menuitem", { name: /clear session messages/i }),
    );
    expect(onClearSession).toHaveBeenCalledWith("sess-1");
  });

  it("badges the live session in the picker", () => {
    render(
      <HistoryPanel
        sessions={[
          session(),
          session({ id: "sess-2", name: "Session · 14:45" }),
        ]}
        currentSessionId="sess-2"
        onNewSession={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
      />,
    );
    // The toolbar button shows the selected (live) session's name; clicking
    // it opens the session sidebar, which carries the live dot.
    fireEvent.click(screen.getByRole("button", { name: /sessions/i }));
    expect(screen.getAllByLabelText(/live session/i)).toHaveLength(1);
  });
});

describe("HistoryPanel chat room", () => {
  it("renders 'you' bubbles right-aligned with the picked color", () => {
    localStorage.setItem(
      "lst.history.options.v3",
      JSON.stringify({
        showSource: false,
        showSpeaker: true,
        showTimestamp: true,
        showLatency: true,
        showModels: true,
        showAvatars: true,
        bubbleColor: "source",
        layout: "chat",
        youColor: "#3b82f6",
      }),
    );
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "Nice shot",
            displayName: "Team",
            fromSelf: false,
          }),
          entry({
            id: "e2",
            text: "Thank you",
            displayName: "You",
            sourceId: "00000000000000000000000000000000",
            color: "#3b82f6",
            fromSelf: true,
          }),
        ],
      }),
    ]);
    const bubbles = screen.getAllByRole("listitem");
    expect(bubbles).toHaveLength(2);
    const selfBubble = bubbles[1];
    expect(selfBubble?.className).toContain("self");
    expect(selfBubble?.className).toContain("chat-bubble");
  });

  it("submits the chat box and clears it on success", async () => {
    const onSendChat = vi.fn().mockResolvedValue("chat-1");
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        onNewSession={vi.fn()}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={onSendChat}
        onOpenYouConfig={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      expect(onSendChat).toHaveBeenCalledWith("hello");
    });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("");
    });
  });

  it("keeps the draft when translation fails", async () => {
    const onSendChat = vi.fn().mockResolvedValue(null);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        onNewSession={vi.fn()}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={onSendChat}
        onOpenYouConfig={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      expect(onSendChat).toHaveBeenCalledWith("hola");
    });
    expect((input as HTMLInputElement).value).toBe("hola");
  });

  it("disables the mic button without a live session", () => {
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        onNewSession={vi.fn()}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={false}
        onToggleMic={vi.fn()}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /translate my voice/i }),
    ).toBeDisabled();
  });

  it("toggles the mic on a live session", () => {
    const onToggleMic = vi.fn().mockResolvedValue(true);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        onNewSession={vi.fn()}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={onToggleMic}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /translate my voice/i }),
    );
    expect(onToggleMic).toHaveBeenCalled();
  });

  it("shows the profile icons toggle in the settings menu", () => {
    renderPanel([session({ entries: [] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: /profile icons/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemcheckbox", {
        name: /tint bubbles with source colors/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("HistoryPanel per-caption bubbles", () => {
  it("renders each caption as its own bubble (no grouping)", () => {
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "First",
            displayName: "Team",
            fromSelf: false,
          }),
          entry({
            id: "e2",
            text: "Second",
            displayName: "Team",
            fromSelf: false,
          }),
        ],
      }),
    ]);
    // Two separate bubbles for two captions.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});

describe("HistoryPanel bubble rendering", () => {
  it("renders per-caption bubbles by default", () => {
    localStorage.removeItem("lst.history.options.v3");
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "Nice shot",
            displayName: "Team",
            fromSelf: false,
          }),
          entry({
            id: "e2",
            text: "Thank you",
            displayName: "You",
            sourceId: "00000000000000000000000000000000",
            fromSelf: true,
          }),
        ],
      }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.className).toContain("self");
    expect(rows[0]?.className).not.toContain("self");
  });
});

describe("HistoryPanel you bubble color", () => {
  it("shows the you-color swatches in the settings menu", () => {
    renderPanel([session({ entries: [] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    expect(
      screen.getByRole("button", { name: /you bubble color #3b82f6/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /you bubble color #ef4444/i }),
    );
    expect(
      (
        JSON.parse(localStorage.getItem("lst.history.options.v3") ?? "{}") as {
          youColor?: string;
        }
      ).youColor,
    ).toBe("#ef4444");
  });
});

describe("HistoryPanel new session button", () => {
  it("invokes onNewSession from the toolbar", () => {
    const onNewSession = vi.fn();
    renderPanel([session()], { onNewSession });
    fireEvent.click(screen.getByRole("button", { name: /new session/i }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});

describe("HistoryPanel first-of-speaker log line", () => {
  it("shows the log/data line above the first bubble of each speaker run only", () => {
    localStorage.setItem(
      "lst.history.options.v3",
      JSON.stringify({
        showSource: false,
        showSpeaker: true,
        showTimestamp: true,
        showLatency: true,
        showModels: true,
        showAvatars: true,
        bubbleColor: "source",
        layout: "chat",
        youColor: "#3b82f6",
      }),
    );
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "First",
            displayName: "Team",
            provider: "whisper-turbo + nllb",
            latencyMs: 120,
          }),
          entry({
            id: "e2",
            text: "Second",
            displayName: "Team",
            provider: "whisper-turbo + nllb",
            latencyMs: 110,
          }),
          entry({
            id: "e3",
            text: "Reply",
            displayName: "You",
            sourceId: "00000000000000000000000000000000",
            fromSelf: true,
            provider: "whisper-turbo + nllb",
            latencyMs: 95,
          }),
          entry({
            id: "e4",
            text: "Back again",
            displayName: "Team",
            provider: "whisper-turbo + nllb",
            latencyMs: 130,
          }),
        ],
      }),
    ]);
    // Speaker + time + latency + model for the first bubble of each speaker.
    expect(screen.getAllByText("Team")).toHaveLength(1);
    expect(screen.getByText("120 ms")).toBeInTheDocument();
    // The later bubbles of the same speaker carry no meta line at all.
    expect(screen.queryByText("110 ms")).toBeNull();
    expect(screen.queryByText("130 ms")).toBeNull();
    // "You" (self) run: one meta line, right side (renders its own label).
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("95 ms")).toBeInTheDocument();
    // The model badge appears exactly twice: once per speaker (Team + You).
    expect(screen.getAllByText("whisper-turbo + nllb")).toHaveLength(2);
  });

  it("shows no log line when every meta toggle is off", () => {
    localStorage.setItem(
      "lst.history.options.v3",
      JSON.stringify({
        showSource: false,
        showSpeaker: false,
        showTimestamp: false,
        showLatency: false,
        showModels: false,
        showAvatars: false,
        bubbleColor: "source",
        layout: "chat",
        youColor: "#3b82f6",
      }),
    );
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "Quiet",
            displayName: "Team",
            provider: "whisper-turbo + nllb",
            latencyMs: 120,
          }),
        ],
      }),
    ]);
    expect(screen.queryByText("120 ms")).toBeNull();
    expect(screen.queryByText("Team")).toBeNull();
  });
});

describe("HistoryPanel separated live controls", () => {
  it("shows Start when idle and starts the separated session", async () => {
    const onStartSeparated = vi.fn().mockResolvedValue(null);
    renderPanel([session()], {
      separatedState: "idle",
      onStartSeparated,
    });
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => {
      expect(onStartSeparated).toHaveBeenCalledTimes(1);
    });
  });

  it("shows Stop while listening and stops the separated session", async () => {
    const onStopSeparated = vi.fn().mockResolvedValue(undefined);
    renderPanel([session()], {
      separatedState: "listening",
      onStopSeparated,
    });
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await waitFor(() => {
      expect(onStopSeparated).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces the separated start error inline", async () => {
    const onStartSeparated = vi
      .fn()
      .mockResolvedValue("Pick a microphone in the config dialog first.");
    renderPanel([session()], {
      separatedState: "idle",
      onStartSeparated,
    });
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Pick a microphone in the config dialog first."),
      ).toBeInTheDocument();
    });
  });
});
