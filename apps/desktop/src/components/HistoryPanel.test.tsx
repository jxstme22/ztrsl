import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "../captions/history";
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
    ...overrides,
  };
}

describe("HistoryPanel", () => {
  it("hides the transcribed input by default", () => {
    render(<HistoryPanel entries={[entry()]} onClear={vi.fn()} />);
    expect(screen.queryByText("sabihin mo")).toBeNull();
    expect(screen.getByText("Say it")).toBeInTheDocument();
  });

  it("shows the transcribed input after toggling the checklist button", () => {
    render(<HistoryPanel entries={[entry()]} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /transcribed/i }));
    expect(screen.getByText("sabihin mo")).toBeInTheDocument();
    expect(screen.getByText("Say it")).toBeInTheDocument();
  });

  it("does not render a source line when the entry has no source text", () => {
    render(
      <HistoryPanel
        entries={[entry({ sourceText: "" })]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /transcribed/i }));
    expect(screen.queryByText("sabihin mo")).toBeNull();
  });
});
