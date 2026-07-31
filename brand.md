# Brand — Local Squad Translator

Private, local English subtitles for Tagalog, Cebuano, and mixed-language squad comms.

_Applied on 2026-07-30. This project uses custom CSS tokens rather than Tailwind/shadcn._

## Palette — Black Ember

**Vibe:** tactile · restrained · technical

**Category:** AI / accessibility tooling

**Mood:** premium · serious

### Core tokens

| Role | OKLCH | Hex |
|---|---|---|
| Background | `oklch(0.12 0.003 20)` | `#070607` |
| Elevated | `oklch(0.17 0.009 20)` | `#100d0e` |
| Surface | `oklch(0.21 0.014 20)` | `#171213` |
| Primary | `oklch(0.61 0.19 19)` | `#dc4d5e` |
| Primary deep | `oklch(0.43 0.17 20)` | `#941f31` |
| Foreground | `oklch(0.96 0.008 12)` | `#f5eff0` |

Use the warmer red only for actions, status, focus, and active navigation. Large areas stay near-black. Raised surfaces use a faint top highlight and broad dark shadow; recessed controls use an inset shadow.

### Contrast

| Pair | Ratio |
|---|---:|
| Foreground / background | 17.81:1 |
| Muted foreground / background | 10.34:1 |
| Subtle foreground / background | 6.11:1 |
| Primary button text / darkest button stop | 8.02:1 |
| Focus / background | 7.78:1 |
| Border / background | 1.51:1 |

All text, focus, icon, and structural-border targets meet WCAG AA.

## Typography

- Display: a locally available condensed face (`Arial Narrow`, then the native display stack).
- Body: Inter when installed, then the native system UI stack.
- Engraved labels, serials, status, and live metrics: the native monospace stack with tabular numerals.
- Instrument titles are condensed and tightly tracked; hardware labels are small, uppercase, and widely tracked.

No remote font dependency is allowed in the local desktop app.

## Physical metaphor — translation rack

The control window is one purpose-built translation instrument, not a collection of interchangeable dashboard cards. Its visual grammar comes from studio rack gear and compact broadcast consoles:

- Chassis: brushed near-black metal, squared rack bays, seams, restrained bevels, and corner screws.
- Meter bridge: persistent navigation and platform lamps read like labeled hardware modules.
- Clip deck: a recessed cassette/service well for selecting a local media source.
- Subtitle monitor: a deep display bezel with a subtle scan-line texture.
- I/O bench: visibly grouped signal, routing, and IPC service bays.
- Controls: rectangular enamel push buttons, rocker switches, recessed selectors, and segmented meters.
- Crimson: an enamel/accent material for active controls and status lamps—not ambient decoration.
- Motion: 100–150 ms mechanical feedback only, disabled under `prefers-reduced-motion`.

Every material treatment must reinforce this shared object model. Do not add isolated novelty knobs, leather, wood, or unrelated retro decoration.

## Tone and voice

Use direct, specific language. Prefer measured facts such as “Local only,” “No audio saved,” and observed latency values.

Avoid hype, urgency, emojis, and vague promises. Never imply a model understood speech when it ran in demo mode.

Voice example:

> Audio stays on this device. Raw clips are discarded after analysis.

## Usage

**Do**

- Use the `--color-*`, `--shadow-*`, and `--radius-*` tokens.
- Preserve high contrast in the caption overlay.
- Use crimson sparingly so active and actionable states remain obvious.
- Give every control hover, focus, pressed, disabled, loading, and error states.

**Don’t**

- Add bright red page-sized backgrounds.
- Revert to generic rounded cards, pill-heavy navigation, or floating dashboard widgets.
- Use flat gray cards or neon glow as decoration.
- Mix unrelated physical metaphors inside the rack.
- Animate layout or exceed 200 ms for routine feedback.
- Render unsanitized transcript HTML.

The previous stylesheet is preserved at `apps/desktop/src/styles.css.bak`.
