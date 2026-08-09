# xTRSNLTR v0.6.0 Build Plan

## Public Beta Distribution, Installation, and Operations

**Depends on:** v0.5 runtime modularization and stable v0.4 accuracy behavior  
**Primary question:** Can a normal Windows user install, configure, update, troubleshoot, and remove xTRSNLTR safely?

## 1. Purpose

v0.6 is a distribution and operations release.

Focus:

- signed Windows installer;
- resumable first-run setup;
- external VB-CABLE onboarding;
- modular runtime packs;
- global and mainland-China model delivery;
- offline packs;
- secure updater and rollback;
- safe mode and diagnostics;
- privacy, licensing, and policy presentation;
- predictable uninstall;
- public-beta readiness.

Do not use v0.6 to introduce a major new ASR architecture.

## 2. Product boundaries

xTRSNLTR remains:

- fully local for audio and captions;
- no telemetry by default;
- no audio/transcript persistence by default;
- external to VALORANT;
- no injection, game-memory reading, input automation, or packet inspection;
- no bundled custom audio driver.

VB-CABLE remains separately installed by the user.

## 3. Installer contents

Core installer:

```text
xTRSNLTR desktop
native core
overlay
audio subsystem
routing wizard
model manager
runtime-pack manager
updater
uninstaller
documentation
```

Not included:

- VB-CABLE binaries;
- large model weights;
- every optional provider;
- private test fixtures;
- developer-only tools unless selected.

## 4. VB-CABLE onboarding

```text
detect endpoints
→ VB-CABLE found?
   ├── yes: continue
   └── no:
       explain why it is useful
       open official source
       save setup checkpoint
       user installs
       restart if needed
       resume wizard
```

Requirements:

- never silently install VB-CABLE;
- never bundle it without written permission;
- never remove it during xTRSNLTR uninstall;
- support users with multiple separately installed cables;
- support process loopback as an alternative source.

## 5. First-run wizard

Sequence:

```text
Welcome
→ local-processing/privacy explanation
→ choose routing mode
→ detect VB-CABLE
→ create sources
→ edit source names and tags
→ select endpoints/processes
→ select headphone monitoring
→ choose language profiles
→ choose strictness
→ detect hardware
→ recommend models/runtime packs
→ choose download region/source
→ install and verify
→ source-isolation test
→ caption preview
→ finish
```

Example:

```text
Name: VALORANT Team
Tag: TEAM
Input: CABLE Output
Language: Taglish
Strictness: Balanced

Name: Discord Friends
Tag: DISCORD
Input: Discord process
Language: Cebuano + English
Strictness: Balanced
```

Preview:

```text
[TEAM] Rotate B!
[DISCORD] Let's go!
```

Wizard progress survives:

- application restart;
- Windows restart;
- interrupted download;
- missing device;
- temporary provider failure.

## 6. Runtime packs

Examples:

```text
Whisper GPU Runtime
Whisper CPU Runtime
Native Omnilingual Runtime
MADLAD Runtime
NLLB Runtime
Developer Diagnostics
```

Pack requirements:

- signed manifest;
- SHA-256 for every artifact;
- compatible app range;
- platform/architecture;
- download size;
- installed size;
- license;
- dependencies;
- rollback;
- removal;
- active-use protection.

## 7. Signed model catalog

Each model entry includes:

```json
{
  "id": "omni-ctc-300m-int8",
  "version": "1",
  "languages": ["ceb", "fil", "en"],
  "profiles": ["cebuano", "bislish"],
  "runtime_id": "runtime-omni-native",
  "disk_bytes": 0,
  "estimated_vram_bytes": 0,
  "license": {
    "spdx": "Apache-2.0",
    "commercial_use": true
  },
  "artifacts": [],
  "providers": [],
  "compatibility": {
    "minimum_app_version": "0.6.0"
  }
}
```

Catalog requirements:

- signature verification;
- rollback to previous catalog;
- deprecation/revocation state;
- canonical hashes independent of provider;
- explicit model/runtime compatibility;
- invalid catalog rejected.

## 8. Mainland-China delivery

User choices:

```text
Automatic
Global
Mainland China
Custom compatible endpoint
Offline pack
```

Potential providers:

- project global CDN;
- Hugging Face;
- ModelScope;
- project mainland-China CDN;
- user-configured mirror.

Automatic flow:

1. verify signed catalog;
2. probe configured providers;
3. test partial download;
4. select responsive source;
5. fail over on stall;
6. resume when possible;
7. verify canonical SHA-256.

Do not rely exclusively on IP geolocation.

## 9. Offline packs

Formats:

```text
*.xtrs-modelpack
*.xtrs-runtimepack
```

Contents:

```text
manifest.json
manifest.sig
LICENSE.txt
NOTICE.txt
checksums.sha256
artifacts/
```

Import:

```text
verify signature
→ verify checksums
→ verify app/runtime compatibility
→ extract to temporary directory
→ atomically install
→ health check
→ activate
```

Requirements:

- no execution before verification;
- path traversal protection;
- rollback;
- duplicate/version handling;
- clear license display.

## 10. Secure updater

Update types:

- application;
- runtime pack;
- model catalog;
- model artifact;
- glossary/filter preset.

Requirements:

- signed metadata;
- HTTPS;
- hash verification;
- stable/alpha/beta/nightly channels;
- rollback;
- interrupted-update recovery;
- compatibility checks;
- no update during active inference drain;
- no silent privacy setting change.

v0.6 ships on the **Beta** channel.

## 11. Code signing

Public builds should sign:

- installer;
- main executable;
- updater;
- native provider binaries;
- external runners;
- packaged sidecars;
- runtime packs where supported.

Never instruct users to disable Windows security or Vanguard.

## 12. Safe mode and crash recovery

Example:

```text
xTRSNLTR did not close normally.

Last failure:
Whisper provider ran out of GPU memory.

Restart normally
Restart in Balanced mode
Restart in Low Resource mode
Disable affected provider
Open diagnostics
```

Safe mode:

- one source;
- provisional captions disabled;
- default overlay;
- experimental providers disabled;
- lowest compatible resource profile;
- settings preserved;
- no automatic deletion.

## 13. Support bundle

Included by default:

- app/runtime versions;
- model IDs and checksums;
- Windows version;
- endpoint health;
- source count and redacted configuration;
- error codes;
- queue/latency summaries;
- hardware summary;
- installer/update logs.

Excluded by default:

- raw audio;
- transcripts;
- translations;
- friend/account names;
- private paths where avoidable;
- IPC tokens.

Content requires separate explicit opt-in.

## 14. Privacy UX

First-run disclosure:

```text
Voice audio is processed locally.
Audio is not uploaded.
Audio and transcripts are not saved by default.
```

Visible states:

```text
Listening
Translation active
Diagnostic recording active
```

Diagnostic recording must be clearly distinct from normal listening.

## 15. Licensing and public policy

Before public beta:

- re-check current Riot third-party application policies;
- resolve product registration if required;
- include the appropriate disclaimer;
- avoid official-looking Riot branding;
- review every bundled runtime and selectable model license;
- clearly mark non-commercial restrictions;
- confirm VB-CABLE is not redistributed without permission;
- publish privacy policy;
- publish security contact/reporting process;
- state that captions and translations are not guaranteed perfect.

## 16. Uninstall

Options:

```text
Remove application only
Remove runtime packs
Remove models
Remove settings
Remove diagnostics
```

Do not remove VB-CABLE automatically.

Requirements:

- stop all processes;
- remove updater/startup entries;
- handle files in use;
- preserve only user-selected data;
- document remaining third-party drivers.

# 17. Build Phases

## Phase 0 — Distribution design freeze

- Define installer architecture.
- Define signed manifest formats.
- Define update channels and rollback.
- Define uninstall behavior.
- Complete threat model.

**Acceptance:** signing, trust, and rollback design approved.

## Phase 1 — Core installer

- Install core app.
- Register uninstaller.
- Launch first-run wizard.
- Handle install scope.
- Validate on clean Windows VM.

**Acceptance:** no developer tools required.

## Phase 2 — Resumable onboarding

- Setup checkpoints.
- VB-CABLE detection.
- Restart-resume flow.
- Source creation and tag editing.
- Hardware/model choices.
- Isolation and caption tests.

**Acceptance:** setup survives restart and interruption.

## Phase 3 — Runtime packs

- Signed pack schema.
- Install/remove.
- Dependency resolution.
- Active-use protection.
- Compatibility checks.

**Acceptance:** users install only needed providers.

## Phase 4 — Signed model catalog

- Signed catalog.
- Canonical hashes.
- Licenses/capabilities.
- Provider lists.
- Rollback/deprecation.

**Acceptance:** invalid catalogs cannot install models.

## Phase 5 — Regional delivery

- Provider probing.
- ModelScope/China provider support.
- Custom endpoint.
- Failover and resume.
- Download diagnostics.

**Acceptance:** Hugging Face is not a hard dependency.

## Phase 6 — Offline packs

- Model/runtime pack import.
- Signature/hash validation.
- Atomic install.
- Rollback.
- Documentation.

**Acceptance:** fully offline setup works.

## Phase 7 — Secure updater

- Signed feed.
- Channels.
- Rollback.
- Interrupted-update recovery.
- Compatibility checks.

**Acceptance:** failed update returns to previous working version.

## Phase 8 — Recovery and support

- Safe mode.
- Crash summary.
- Support bundle.
- Guided troubleshooting.
- Privacy redaction.

**Acceptance:** users can recover without deleting configuration.

## Phase 9 — Privacy, licensing, and policy

- First-run disclosure.
- Third-party notices.
- License UI.
- Riot policy status.
- Branding review.
- Security reporting documentation.

**Acceptance:** public documentation is complete.

## Phase 10 — Clean-machine matrix

Test:

- clean Windows 11;
- CPU-only;
- supported NVIDIA GPU;
- one VB-CABLE;
- multiple cables;
- process capture;
- global provider;
- mainland-China provider;
- offline packs;
- interrupted setup/update;
- uninstall/reinstall.

**Acceptance:** no blocker across supported matrix.

## Phase 11 — Closed beta

- Limited tester group.
- Setup completion review.
- Crash review.
- Update/rollback drill.
- Privacy review.

**Acceptance:** no critical distribution blockers.

## Phase 12 — Public beta

- Publish signed artifacts.
- Publish release notes and limitations.
- Publish support and policy status.
- Monitor critical issues.

**Acceptance:** final release checklist passes.

# 18. Release Criteria

- [ ] Clean Windows installation works.
- [ ] VB-CABLE remains a separate dependency.
- [ ] Setup resumes after restart.
- [ ] Source names/tags are editable.
- [ ] Models install globally, in mainland China, or offline.
- [ ] Runtime/model catalogs are signed.
- [ ] Updates can roll back.
- [ ] Safe mode works.
- [ ] Support bundles exclude conversations by default.
- [ ] Uninstall is predictable.
- [ ] Public binaries are signed.
- [ ] Model/runtime licenses are visible.
- [ ] Riot policy review is documented.
- [ ] Privacy policy and security contact exist.
- [ ] Release is labeled Beta.
- [ ] Automated and clean-machine tests pass.

# 19. Codex Prompt

```text
Read AGENTS.md, README.md, the v0.5 validation report, and this file.

Treat v0.6 as a distribution and operations release. Avoid major new
inference features.

VB-CABLE is a separately installed third-party dependency. Do not bundle or
uninstall it without explicit permission.

Implement signed catalogs, runtime packs, regional providers, offline packs,
secure updates, rollback, safe mode, support bundles, and resumable onboarding.

For each phase:
1. restate acceptance criteria;
2. implement the smallest complete slice;
3. test on clean Windows where required;
4. verify signatures and rollback;
5. update documentation;
6. report evidence and unresolved blockers.

Do not call the release stable. It is a public beta.
```
