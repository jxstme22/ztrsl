import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      micEnabled={false}
      micConfigured={true}
      liveRunning={true}
      onToggleMic={vi.fn()}
      onSendChat={vi.fn()}
      onOpenYouConfig={vi.fn()}
      onOpenMicSettings={vi.fn()}
      separatedState={"idle"}
      separatedError={null}
      onStartSeparatedLive={vi.fn()}
      onStopSeparatedLive={vi.fn()}
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
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
        onOpenMicSettings={vi.fn()}
        separatedState={"idle"}
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    // The toolbar button shows the selected (live) session's name; clicking
    // it opens the session sidebar, which carries the live dot.
    fireEvent.click(screen.getByRole("button", { name: /sessions/i }));
    expect(screen.getAllByLabelText(/live session/i)).toHaveLength(1);
  });
});

describe("HistoryPanel chat room", () => {
  it("renders 'you' bubbles right-aligned with the you label", () => {
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
      }),
    );
    renderPanel([session({
      entries: [
        entry({ id: "e1", text: "Nice shot", displayName: "Team", fromSelf: false }),
        entry({
          id: "e2",
          text: "Thank you",
          sourceText: "谢谢",
          displayName: "You",
          sourceId: "00000000000000000000000000000000",
          color: "#dc4d5e",
          fromSelf: true,
        }),
      ],
    })]);
    const bubbles = screen.getAllByRole("listitem");
    expect(bubbles).toHaveLength(2);
    const selfBubble = bubbles[1];
    expect(selfBubble?.className).toContain("self");
    expect(selfBubble?.className).toContain("chat-bubble");
    expect(screen.getAllByText("You")).not.toHaveLength(0);
  });

  it("submits the chat box and clears it on success", async () => {
    const onSendChat = vi.fn().mockResolvedValue("chat-1");
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
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
        onOpenMicSettings={vi.fn()}
        separatedState={"idle"}
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => { expect(onSendChat).toHaveBeenCalledWith("hello"); });
    await waitFor(() => { expect((input as HTMLInputElement).value).toBe(""); });
  });

  it("keeps the draft when translation fails", async () => {
    const onSendChat = vi.fn().mockResolvedValue(null);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
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
        onOpenMicSettings={vi.fn()}
        separatedState={"idle"}
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => { expect(onSendChat).toHaveBeenCalledWith("hola"); });
    expect((input as HTMLInputElement).value).toBe("hola");
  });

  it("disables the mic button without a live session", () => {
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
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
        onOpenMicSettings={vi.fn()}
        separatedState={"idle"}
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /translate my voice/i })).toBeDisabled();
  });

  it("toggles the mic on a live session", () => {
    const onToggleMic = vi.fn().mockResolvedValue(true);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
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
        onOpenMicSettings={vi.fn()}
        separatedState={"idle"}
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /translate my voice/i }));
    expect(onToggleMic).toHaveBeenCalled();
  });

  it("shows the profile icons toggle in the settings menu", () => {
    renderPanel([session({ entries: [] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    expect(screen.getByRole("menuitemcheckbox", { name: /profile icons/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemcheckbox", { name: /tint bubbles with source colors/i }),
    ).toBeInTheDocument();
  });
});

describe("HistoryPanel bubble grouping", () => {
  const chatOptions = () => {
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
      }),
    );
  };

  it("merges consecutive same-speaker entries into one bubble", () => {
    chatOptions();
    renderPanel([
      session({
        entries: [
          entry({
            id: "e1",
            text: "First",
            displayName: "Team",
            sourceId: "0123456789abcdef0123456789abcdef",
            fromSelf: false,
          }),
          entry({
            id: "e2",
            text: "Second",
            displayName: "Team",
            sourceId: "0123456789abcdef0123456789abcdef",
            fromSelf: false,
          }),
          entry({
            id: "e3",
            text: "Other speaker",
            displayName: "Discord",
            sourceId: "22222222222222222222222222222222",
            fromSelf: false,
          }),
        ],
      }),
    ]);
    // Two bubbles: Team's two messages merged, Discord separate.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Other speaker")).toBeInTheDocument();
  });

  it("keeps different speakers as separate bubbles", () => {
    chatOptions();
    renderPanel([
      session({
        entries: [
          entry({ id: "e1", text: "A", displayName: "Team", fromSelf: false }),
          entry({
            id: "e2",
            text: "B",
            displayName: "You",
            fromSelf: true,
          }),
          entry({ id: "e3", text: "C", displayName: "Team", fromSelf: false }),
        ],
      }),
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("HistoryPanel classic layout", () => {
  it("renders classic rows by default with you-entries right-aligned", () => {
    localStorage.removeItem("lst.history.options.v3");
    renderPanel([
      session({
        entries: [
          entry({ id: "e1", text: "Nice shot", displayName: "Team", fromSelf: false }),
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
    const selfRow = rows[1];
    expect(selfRow?.className).toContain("self");
    expect(selfRow?.className).toContain("history-entry-classic");
    expect(rows[0]?.className).not.toContain("self");
  });

  it("switches to chat bubbles via the settings menu", () => {
    localStorage.removeItem("lst.history.options.v3");
    renderPanel([session({ entries: [] })]);
    fireEvent.click(screen.getByRole("button", { name: /display options/i }));
    // The layout picker is a nested submenu: open it first.
    fireEvent.click(screen.getByRole("menuitem", { name: /^layout/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /chat bubbles/i }));
    expect(
      (
        JSON.parse(
          localStorage.getItem("lst.history.options.v3") ?? "{}",
        ) as { layout?: string }
      ).layout,
    ).toBe("chat");
  });
});

describe("HistoryPanel separated live", () => {
  it("shows a Start pill when idle and starts the separated live", () => {
    const onStart = vi.fn().mockResolvedValue(null);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
        onOpenMicSettings={vi.fn()}
        separatedState="idle"
        separatedError={null}
        onStartSeparatedLive={onStart}
        onStopSeparatedLive={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("shows a Stop pill while the separated live is listening", () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoryPanel
        sessions={[session({ entries: [] })]}
        currentSessionId={null}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onClearSession={vi.fn()}
        micEnabled={false}
        micConfigured={true}
        liveRunning={true}
        onToggleMic={vi.fn()}
        onSendChat={vi.fn()}
        onOpenYouConfig={vi.fn()}
        onOpenMicSettings={vi.fn()}
        separatedState="listening"
        separatedError={null}
        onStartSeparatedLive={vi.fn()}
        onStopSeparatedLive={onStop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it("opens the session sidebar as an in-card column via the toolbar toggle", () => {
    renderPanel([session(), session({ id: "sess-2", name: "Older" })]);
    fireEvent.click(screen.getByRole("button", { name: /sessions/i }));
    expect(screen.getByRole("complementary", { name: /sessions/i })).toBeInTheDocument();
    // Clicking a session picks it and hides the sidebar.
    fireEvent.click(screen.getByRole("button", { name: /older/i }));
    expect(screen.queryByRole("complementary", { name: /sessions/i })).toBeNull();
  });
});
