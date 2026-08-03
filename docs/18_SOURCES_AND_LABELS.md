# 18 — Sources and Caption Labels

Sources are the voice channels xTRSNLTR listens to. Each source is identified
by an **immutable source id** (a random 32-char hex value) — never by its name
or tag, so you can rename freely without interrupting capture.

## Adding a source

In **Sources**, click **Add source**, pick a preset or a custom endpoint, then
set:

- **Name** — a free-form label shown in the app.
- **Caption tag** — the short marker on the overlay (e.g. `TEAM`).
- **Label style** — how the tag renders:
  - `brackets` → `[TEAM]`
  - `colon` → `TEAM:`
  - `bullet` → `• TEAM`
  - `stacked` → tag on its own line
  - `hidden` → no tag
- **Language profile** — how the source is expected to speak.
- **Strictness** — how aggressively mismatched speech is filtered.

Tags are **data, never code**: a tag containing `<script>` or quotes renders
as plain text, and can never execute.

## Renaming while active

Changing a source's name or tag mid-session does not interrupt audio, ASR, or
the caption stream — the immutable id keeps everything connected. Captions
already on screen keep the tag they were sent with; new captions use the new
tag.

## Simultaneous captions

When multiple sources speak at once, the overlay shows up to two lanes.
Settings → Overlay lets you choose:

- **Show both lanes** — primary source plus the newest other lane.
- **Newest caption wins** — only the single newest caption.
- **Primary source wins** — only the primary lane, falling back to the newest.

You can also pin a **primary source** and **hide** individual sources.
