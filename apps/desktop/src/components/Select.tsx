import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { setOverlayVisible } from "../windowEffects";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};

export type SelectProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  placeholder?: string;
};

type Row =
  | { kind: "group"; label: string }
  | { kind: "option"; option: SelectOption; index: number };

export function Select({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const buttonId = id ?? `${generatedId}-button`;
  const listboxId = `${buttonId}-listbox`;

  const items: readonly SelectOption[] = placeholder
    ? [{ value: "", label: placeholder }, ...options]
    : options;
  const enabledIndexes = items.flatMap((item, index) =>
    item.disabled ? [] : [index],
  );
  const selectedIndex = items.findIndex((item) => item.value === value);
  const activeIndex = highlighted >= 0 ? highlighted : selectedIndex;

  useEffect(() => {
    setOverlayVisible(!open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHighlighted(selectedIndex);
    const onPointerDown = (event: PointerEvent) => {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedIndex]);

  const choose = (index: number) => {
    const item = items[index];
    if (item === undefined || item.disabled) return;
    setOpen(false);
    if (item.value !== value) {
      onChange(item.value);
    }
    buttonRef.current?.focus();
  };

  const moveHighlight = (delta: number) => {
    const position = enabledIndexes.indexOf(activeIndex);
    const start = position < 0 ? (delta > 0 ? -1 : 0) : position;
    const next = enabledIndexes[Math.min(
      enabledIndexes.length - 1,
      Math.max(0, start + delta),
    )];
    if (next !== undefined) {
      setHighlighted(next);
    }
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlighted(selectedIndex);
        return;
      }
    }
    if (!open) return;
    switch (event.key) {
      case "ArrowDown":
        moveHighlight(1);
        break;
      case "ArrowUp":
        moveHighlight(-1);
        break;
      case "Home":
        setHighlighted(enabledIndexes[0] ?? -1);
        break;
      case "End":
        setHighlighted(enabledIndexes[enabledIndexes.length - 1] ?? -1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeIndex >= 0) {
          choose(activeIndex);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const rows: Row[] = [];
  let lastGroup: string | undefined;
  items.forEach((item, index) => {
    if (item.group !== undefined && item.group !== lastGroup) {
      rows.push({ kind: "group", label: item.group });
      lastGroup = item.group;
    }
    rows.push({ kind: "option", option: item, index });
  });

  const selected = items[selectedIndex] ?? null;

  return (
    <div className="lst-select" ref={rootRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-option-${String(activeIndex)}`
            : undefined
        }
        className={`lst-select-button ${open ? "open" : ""}`}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className={selected === null ? "lst-select-placeholder" : ""}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown aria-hidden="true" size={14} className="lst-select-chevron" />
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="lst-select-listbox"
        >
          {rows.map((row) =>
            row.kind === "group" ? (
              <div
                key={`group-${row.label}`}
                className="lst-select-group"
                role="presentation"
              >
                {row.label}
              </div>
            ) : (
              <div
                key={`option-${row.option.value}`}
                id={`${listboxId}-option-${String(row.index)}`}
                role="option"
                aria-selected={row.option.value === value}
                aria-disabled={row.option.disabled}
                className={`lst-select-option ${
                  row.option.disabled ? "disabled" : ""
                } ${activeIndex === row.index ? "highlighted" : ""}`}
                onClick={() => {
                  choose(row.index);
                }}
                onPointerMove={() => {
                  if (!row.option.disabled) {
                    setHighlighted(row.index);
                  }
                }}
              >
                <span>{row.option.label}</span>
                {row.option.value === value && (
                  <Check
                    aria-hidden="true"
                    size={14}
                    className="lst-select-check"
                  />
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
