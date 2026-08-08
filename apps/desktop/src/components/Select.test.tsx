import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

describe("Select", () => {
  it("closes the listbox after picking an option", () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Pick a model"
        value="whisper-turbo"
        onChange={onChange}
        options={[
          { value: "whisper-turbo", label: "Whisper Turbo" },
          { value: "nllb", label: "NLLB" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /pick a model/i }));
    expect(screen.getByRole("option", { name: "NLLB" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "NLLB" }));
    expect(onChange).toHaveBeenCalledWith("nllb");
    // The listbox must be gone after the pick.
    expect(screen.queryByRole("option", { name: "NLLB" })).toBeNull();
  });

  it("closes the listbox after picking an option inside a label", () => {
    const onChange = vi.fn();
    render(
      <label>
        Model
        <Select
          label="Model"
          value="whisper-turbo"
          onChange={onChange}
          options={[
            { value: "whisper-turbo", label: "Whisper Turbo" },
            { value: "nllb", label: "NLLB" },
          ]}
        />
      </label>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /model/i }));
    fireEvent.click(screen.getByRole("option", { name: "NLLB" }));
    expect(onChange).toHaveBeenCalledWith("nllb");
    expect(screen.queryByRole("option", { name: "NLLB" })).toBeNull();
  });
});
