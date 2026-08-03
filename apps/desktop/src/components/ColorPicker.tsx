import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Custom color picker matching the app's Select/listbox design language.
 * Replaces the native `<input type="color">` (whose OS popup is unstylable and
 * inconsistent across pages) with a branded swatch + preset palette.
 */

export const PRESET_COLORS: readonly string[] = [
  "#7dd3fc", // sky
  "#a5f3fc", // cyan
  "#6ee7b7", // emerald
  "#bef264", // lime
  "#fde047", // yellow
  "#fbbf24", // amber
  "#fb923c", // orange
  "#f87171", // red
  "#f9a8d4", // pink
  "#c4b5fd", // violet
  "#a78bfa", // purple
  "#f5eff0", // foreground
];

export type ColorPickerProps = {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
};

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const listboxId = `${generatedId}-colors`;
  const selected = value ?? PRESET_COLORS[0] ?? "#7dd3fc";

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlighted(PRESET_COLORS.indexOf(selected));
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
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
  }, [open, selected]);

  const choose = (color: string) => {
    setOpen(false);
    if (color !== value) {
      onChange(color);
    }
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlighted(PRESET_COLORS.indexOf(selected));
      }
      return;
    }
    if (!open) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        setHighlighted((current) => (current + 1) % PRESET_COLORS.length);
        break;
      case "ArrowUp":
        setHighlighted(
          (current) => (current - 1 + PRESET_COLORS.length) % PRESET_COLORS.length,
        );
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (highlighted >= 0) {
          const color = PRESET_COLORS[highlighted];
          if (color !== undefined) {
            choose(color);
          }
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="lst-color" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        id={`${generatedId}-button`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={`lst-color-button ${open ? "open" : ""}`}
        onClick={() => {
          setOpen((current) => !current);
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className="lst-color-swatch" style={{ background: selected }} />
        <span className="lst-color-value">{selected}</span>
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="lst-color-listbox"
        >
          {PRESET_COLORS.map((color, index) => (
            <div
              key={color}
              id={`${listboxId}-option-${String(index)}`}
              role="option"
              aria-selected={color === selected}
              className={`lst-color-option ${highlighted === index ? "highlighted" : ""}`}
              onClick={() => {
                choose(color);
              }}
              onPointerMove={() => {
                setHighlighted(index);
              }}
            >
              <span className="lst-color-swatch" style={{ background: color }} />
              <span>{color}</span>
              {color === selected && <Check aria-hidden="true" size={14} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
