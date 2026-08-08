import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SourcesPanel } from "./SourcesPanel";

type PersistedSource = {
  sourceId: string;
  captionTag: string;
};

function readPersistedSources(): PersistedSource[] {
  const raw = window.localStorage.getItem("local-squad-translator.sources.v4");
  const parsed = JSON.parse(raw ?? "{}") as {
    sources: PersistedSource[];
  };
  return parsed.sources;
}

describe("SourcesPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("migrates and shows one source with a caption preview", () => {
    render(<SourcesPanel />);

    expect(screen.getByText("Audio sources")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Valorant Team" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
    expect(screen.getByLabelText("Caption preview").textContent).toContain(
      "[TEAM] Rotate B!",
    );
  });

  it("keeps the internal id stable when the tag is edited", () => {
    render(<SourcesPanel />);

    const before = readPersistedSources();

    const tagInput = screen.getByPlaceholderText("TEAM");
    fireEvent.change(tagInput, { target: { value: "MYTEAM" } });
    fireEvent.blur(tagInput);

    const after = readPersistedSources();
    expect(after[0]?.sourceId).toBe(before[0]?.sourceId);
    expect(after[0]?.captionTag).toBe("MYTEAM");
    expect(screen.getByLabelText("Caption preview").textContent).toContain(
      "[MYTEAM] Rotate B!",
    );
  });

  it("adds a source from a preset", async () => {
    render(<SourcesPanel />);

    fireEvent.click(screen.getByRole("combobox", { name: "Add source" }));
    const option = await screen.findByRole("option", { name: "Discord" });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));

    expect(
      screen.getByRole("heading", { name: "Discord" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 8")).toBeInTheDocument();
  });

  it("does not remove the last source", () => {
    render(<SourcesPanel />);

    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toBeDisabled();
  });

  it("shows duplicate-tag warnings", async () => {
    render(<SourcesPanel />);

    fireEvent.click(screen.getByRole("combobox", { name: "Add source" }));
    const option = await screen.findByRole("option", { name: "Custom" });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));

    const inputs = screen.getAllByPlaceholderText("TEAM");
    const secondInput = inputs[1];
    if (secondInput === undefined) {
      throw new Error("expected a second tag input");
    }
    fireEvent.change(secondInput, { target: { value: "TEAM" } });

    expect(
      screen.getAllByText(/also used by another source/).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
