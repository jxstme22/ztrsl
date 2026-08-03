import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaptionTrustPanel } from "./CaptionTrustPanel";

describe("CaptionTrustPanel", () => {
  it("renders both editors", () => {
    render(<CaptionTrustPanel />);
    expect(screen.getByText("Phrase filters")).toBeInTheDocument();
    expect(screen.getByText("Glossary & corrections")).toBeInTheDocument();
  });

  it("adds a phrase filter rule", async () => {
    render(<CaptionTrustPanel />);
    screen.getByRole("button", { name: "Add filter" }).click();
    await waitFor(() => {
      expect(screen.getAllByLabelText("Phrase").length).toBeGreaterThan(0);
    });
  });

  it("adds a glossary entry", async () => {
    render(<CaptionTrustPanel />);
    screen.getByRole("button", { name: "Add entry" }).click();
    await waitFor(() => {
      expect(screen.getAllByLabelText("From").length).toBeGreaterThan(0);
    });
  });
});
