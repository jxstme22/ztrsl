# Security, Privacy, and Riot Compliance Boundaries

## 1. Purpose

This document is a hard engineering constraint, not general advice.

The product is an accessibility/live-translation companion. It must remain external to the game and must not create an unfair gameplay advantage through hidden information or automation.

## 2. Allowed Interactions

- enumerate Windows audio endpoints;
- capture an endpoint selected by the user;
- forward captured audio to a user-selected output;
- process audio locally;
- render an ordinary transparent top-level window;
- register user-configured hotkeys;
- store local settings;
- optionally save diagnostics with explicit consent.

## 3. Forbidden Interactions

- DLL injection;
- graphics API hooking;
- reading/writing VALORANT memory;
- opening the process for hidden game-state extraction;
- reverse engineering Vanguard;
- bypassing anti-cheat;
- packet sniffing for game information;
- reading private APIs;
- game-file modification;
- input automation;
- recoil/aim/movement assistance;
- tactical advice generated from hidden state;
- OCR/screen analysis for competitive intelligence;
- disguising the overlay as official UI.

If a feature requires any forbidden interaction, do not implement it.

## 4. Product Registration

Before public distribution, review current Riot policies and register the product where required. The project documentation must include the current required legal disclaimer in the visible About/Legal area once wording is verified.

Policy can change. Add a release checklist item to re-check policy on every public release.

## 5. Anti-Cheat Positioning

No developer can guarantee future anti-cheat treatment.

Risk reduction:

- external-only process;
- no elevated privileges for normal operation;
- no kernel driver;
- no game process access;
- no game hooks;
- signed binaries;
- stable publisher identity for public builds;
- transparent documentation;
- user-visible indicator when capture is active;
- product registration/policy contact before release.

## 6. Voice Privacy and Consent

Voice belongs to real people. The product should:

- process locally by default;
- avoid recording;
- avoid transcript history;
- explain that other participants' voices are being processed;
- recommend user compliance with local laws and platform rules;
- provide a visible capture/translation indicator;
- make deletion easy when diagnostics are recorded.

Do not use captured voice to train models without explicit, informed consent covering that use.

## 7. Data Classification

### Ephemeral Sensitive

- raw voice samples;
- source transcripts;
- translations;
- optional speaker embeddings.

Default: memory only, short-lived.

### Local Configuration

- device IDs;
- overlay position;
- model profile;
- glossary;
- hotkeys.

Persist locally.

### Diagnostic Metadata

- latency;
- queue length;
- error code;
- model ID;
- text length.

Persist only when useful; exclude content.

## 8. IPC Security

- bind to loopback;
- random launch token;
- authenticate before accepting audio;
- one desktop client by default;
- message size limits;
- request rate limits;
- protocol version validation;
- terminate after repeated auth failures;
- do not expose debug endpoints in release builds.

## 9. Model Supply Chain

For every model:

- official or vetted source;
- pinned artifact;
- SHA-256 checksum;
- license record;
- expected file size;
- safe file format;
- no remote code execution;
- no automatic update without verification;
- rollback support.

Do not set `trust_remote_code=True` in production.

## 10. Desktop Supply Chain

- lockfiles committed;
- dependency audit;
- reproducible CI where practical;
- SBOM for public builds;
- signed installer;
- update manifests signed;
- HTTPS;
- release hashes published.

## 11. Logging

Default logs must not contain:

- transcript text;
- raw audio;
- friend names;
- Riot account names;
- full local paths where avoidable;
- IPC token.

Debug content logging requires a separate explicit switch and visible warning.

## 12. Crash Dumps

Crash dumps may contain transcript/audio memory.

For public builds:

- disable automatic upload;
- request consent before collection;
- document sensitivity;
- sanitize where possible;
- set retention limits.

## 13. Threat Model

### Local Malicious Process

Could connect to sidecar, read captions, or inject data.

Mitigations:

- per-launch token;
- loopback only;
- randomized port;
- process ownership checks if robust and non-invasive;
- short session lifetime;
- strict validation.

### Malicious Model Artifact

Could exploit parser/runtime.

Mitigations:

- checksums;
- safe formats;
- pinned runtime;
- no remote code;
- low-privilege process;
- model directory permission checks.

### Accidental Feedback

Could cause loud repeated audio.

Mitigations:

- topology validation;
- level guard;
- correlation heuristic;
- immediate monitor mute;
- volume ramp.

### Overlay Input Capture

Could disrupt gameplay.

Mitigations:

- no-activate;
- click-through;
- focus invariant telemetry;
- emergency hotkey;
- startup overlay hidden until configured.

## 14. Public Release Legal Checklist

- Riot registration/status reviewed.
- Required disclaimer present.
- Product name/branding reviewed.
- Virtual cable redistribution rights reviewed.
- Model licenses and notices included.
- Privacy policy published.
- Voice processing disclosure published.
- Terms and support contact published.
- Code signing certificate valid.
- Update policy documented.
