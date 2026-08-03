import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupWizard } from "./SetupWizard";

type PersistedSource = {
  sourceId: string;
  captionTag: string;
  captureTarget: { kind: string; endpointId?: string | null };
};

function readPersistedSources(): PersistedSource[] {
  const raw = window.localStorage.getItem("local-squad-translator.sources.v3");
  const parsed = JSON.parse(raw ?? "{}") as { sources: PersistedSource[] };
  return parsed.sources;
}

function stepHeading(name: string) {
  return screen.findByRole("heading", { name });
}

function pickOption(comboboxName: string, optionLabel: string, index = 0) {
  const combo = screen.getAllByRole("combobox", { name: comboboxName })[index];
  if (!combo) {
    throw new Error(`no combobox "${comboboxName}" at index ${String(index)}`);
  }
  fireEvent.click(combo);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("SetupWizard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the setup type step first", async () => {
    render(<SetupWizard onFinish={vi.fn()} />);

    expect(await stepHeading("Choose a setup type")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText(/never bundles it/)).toBeInTheDocument();
  });

  it("recommended mode advances and prefills TEAM and DISCORD with previews", async () => {
    render(<SetupWizard onFinish={vi.fn()} />);

    fireEvent.click(await screen.findByText("Recommended"));
    expect(await stepHeading("Add the first source")).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Valorant Team" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Discord" })).toHaveLength(1);
    expect(screen.getAllByLabelText("Caption preview").length).toBe(2);
  });

  it("select-capture step gates Next until every source is assigned", async () => {
    render(<SetupWizard onFinish={vi.fn()} />);

    fireEvent.click(await screen.findByText("Recommended"));
    fireEvent.click(await screen.findByRole("button", { name: /Next/ }));
    expect(
      await stepHeading("Choose a capture method for each source"),
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(
      screen.getByText(/Assign a capture method to every source/),
    ).toBeInTheDocument();
  });

  it("blocks the recommended VALORANT routing step without VB-CABLE", async () => {
    render(<SetupWizard onFinish={vi.fn()} />);

    fireEvent.click(await screen.findByText("Recommended"));
    fireEvent.click(await screen.findByRole("button", { name: /Next/ }));
    pickOption("Capture method", "Generated voice signal (macOS simulator)", 0);
    pickOption("Capture method", "Generated voice signal (macOS simulator)", 1);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(await stepHeading("Route VALORANT audio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/vb-audio\.com/);
    expect(screen.getByText(/VB-CABLE was not found/)).toBeInTheDocument();
  });

  it("walks the advanced flow end-to-end and saves schema-v3 sources", async () => {
    const onFinish = vi.fn();
    render(<SetupWizard onFinish={onFinish} />);

    fireEvent.click(await screen.findByText("Advanced"));
    expect(await stepHeading("Add the first source")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add source/ }));
    expect(
      await screen.findByRole("heading", { name: "Valorant Team" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(
      await stepHeading("Choose a capture method for each source"),
    ).toBeInTheDocument();
    pickOption("Capture method", "Generated voice signal (macOS simulator)");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Next/ }));

    expect(
      await stepHeading("Add a Discord or social source"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add source/ }));
    await waitFor(() => {
      expect(screen.getAllByText("Discord").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(
      await stepHeading("Choose the monitoring output"),
    ).toBeInTheDocument();
    pickOption("Headphone output", "Silent test sink (macOS simulator)");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(await stepHeading("Source isolation test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await stepHeading("Monitoring test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(
      await stepHeading("Language profile and strictness per source"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await stepHeading("Overlay preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await stepHeading("Save preset")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save preset/ }));
    expect(await screen.findByText("Setup saved")).toBeInTheDocument();

    const persisted = readPersistedSources();
    expect(persisted).toHaveLength(2);
    expect(persisted[0]?.captionTag).toBe("TEAM");
    expect(persisted[1]?.captionTag).toBe("DISCORD");
    expect(persisted[0]?.captureTarget.kind).toBe("endpoint");
    expect(persisted[0]?.captureTarget.endpointId).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Audio sources/ }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
