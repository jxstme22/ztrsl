# Release, Installer, and Operations

## 1. Distribution Model

Recommended:

- small signed application installer;
- models downloaded during first-run setup;
- virtual cable installed separately from its official vendor;
- offline model import supported for advanced users.

Avoid a multi-gigabyte monolithic installer unless there is a strong reason.

## 2. Installer Responsibilities

- install desktop binaries;
- install sidecar runtime;
- create application data directories;
- add Start Menu shortcut;
- optionally start on login only with explicit consent;
- register uninstaller;
- never install a driver silently;
- never modify VALORANT files or settings.

## 3. Application Directories

Suggested:

```text
%LOCALAPPDATA%\LocalSquadTranslator\
├── app\
├── models\
├── logs\
├── cache\
└── diagnostics\
```

Settings may use `%APPDATA%` if roaming is truly desired; device IDs and large models should not roam.

## 4. Model Manager

For each model:

- description;
- disk size;
- estimated VRAM profile;
- source;
- license;
- checksum;
- download progress;
- verify phase;
- remove;
- repair.

Atomic install:

1. download to temporary file;
2. verify size/checksum;
3. extract to temporary directory;
4. verify expected contents;
5. atomically rename;
6. update installed manifest.

## 5. Sidecar Packaging

Options:

### A. Python embedded distribution

Pros:

- reliable parity with development;
- easiest initial packaging.

Cons:

- large;
- dependency complexity;
- antivirus false positives;
- slower startup.

### B. Frozen executable

Pros:

- simpler user launch.

Cons:

- very large;
- CUDA/PyTorch bundling complexity;
- slower build;
- signing requirements.

### C. Native ONNX runtime

Pros:

- best long-term packaging.

Cons:

- more engineering;
- translation export/runtime validation.

V1 private alpha may use a managed Python environment. Public beta should benchmark frozen versus native.

## 6. Updates

The updater must:

- use signed metadata;
- verify hashes;
- support rollback;
- not replace models unnecessarily;
- not enable telemetry/history;
- show material privacy or model changes.

Model updates are separate from app updates.

## 7. Code Signing

Public Windows builds should sign:

- installer;
- desktop executable;
- sidecar executable;
- updater.

Do not instruct users to disable security software.

## 8. Release Channels

```text
dev
alpha
beta
stable
```

Model manifests may have their own channel but must remain compatible with app protocol.

## 9. Support Bundle

User-triggered support bundle contains:

- app version;
- OS version;
- model IDs/checksums;
- device names optionally redacted;
- error codes;
- latency/resource summary;
- recent logs without transcript content.

It must not include audio/transcripts unless the user separately checks an explicit box.

## 10. Uninstall

Offer:

- remove app only;
- remove models;
- remove settings;
- remove diagnostics.

Do not remove the third-party virtual cable automatically unless the user uses its official uninstaller.

## 11. Clean-Machine Validation

Use a Windows VM or clean physical test machine:

1. install app;
2. run without models;
3. complete model setup;
4. install virtual cable from official source;
5. configure routing;
6. test subtitles;
7. update;
8. uninstall;
9. inspect residual files;
10. reinstall and restore settings behavior.

## 12. Operational Metrics

Local diagnostics:

- app startup;
- sidecar startup;
- model warmup;
- capture continuity;
- caption latency;
- error counts;
- queue drops;
- model OOM.

No remote telemetry by default.

## 13. Release Notes Must State

- model changes;
- expected quality changes;
- VRAM changes;
- privacy changes;
- new permissions;
- known VALORANT/display-mode limitations;
- policy/compliance status;
- rollback instructions.
