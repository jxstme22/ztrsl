# Acceptance Checklist

Use this as the final audit source of truth.

## A. Repository

- [ ] Clean clone setup is documented.
- [ ] Lockfiles are committed.
- [ ] Formatting, linting, typechecking, and tests have one-command workflows.
- [ ] CI runs without downloading large models.
- [ ] Hardware/model tests are tagged separately.
- [ ] ADRs exist for required decisions.

## B. Safety Boundaries

- [ ] No DLL injection.
- [ ] No graphics hooks.
- [ ] No VALORANT memory reads/writes.
- [ ] No packet interception.
- [ ] No game-file changes.
- [ ] No input automation.
- [ ] No kernel component.
- [ ] No anti-cheat bypass logic.
- [ ] No hidden tactical data.
- [ ] Overlay is an external normal Windows window.

## C. Audio

- [ ] Endpoints enumerate with stable IDs.
- [ ] Device notifications are handled.
- [ ] Selected virtual endpoint can be captured.
- [ ] Monitoring reaches selected headphones.
- [ ] Game audio can remain on headphones separately.
- [ ] Monitoring does not depend on inference.
- [ ] Inference feed is 16 kHz mono.
- [ ] Buffers are bounded.
- [ ] Underflow/overflow are measured.
- [ ] Device invalidation is recoverable.
- [ ] Feedback configuration is blocked or auto-muted.
- [ ] Two-hour soak test shows bounded memory.

## D. IPC

- [ ] Loopback only.
- [ ] Random per-launch token.
- [ ] Authenticated handshake.
- [ ] Version negotiation.
- [ ] Binary size limits.
- [ ] Runtime schema validation.
- [ ] Stale revisions rejected.
- [ ] Sidecar shuts down with desktop.
- [ ] Crash/restart behavior is controlled.
- [ ] LAN connection attempt fails.

## E. VAD

- [ ] Pre-roll.
- [ ] Minimum speech.
- [ ] Hangover silence.
- [ ] Maximum utterance.
- [ ] Forced split.
- [ ] Silence false positives measured.
- [ ] Game-like noise false positives measured.
- [ ] No default audio persistence.

## F. ASR

- [ ] Filipino mode.
- [ ] Cebuano mode.
- [ ] Mixed mode.
- [ ] 300M int8 baseline.
- [ ] Model checksum verification.
- [ ] Local-files-only load.
- [ ] No remote code execution.
- [ ] Warmup and load metrics.
- [ ] Missing/corrupt model recovery.
- [ ] OOM recovery.
- [ ] WER/CER benchmark.
- [ ] Critical tactical-error benchmark.

## G. Translation

- [ ] English target.
- [ ] Filipino fixtures.
- [ ] Cebuano fixtures.
- [ ] Taglish fixtures.
- [ ] Bislish fixtures.
- [ ] Protected terminology.
- [ ] Already-English skip logic.
- [ ] Quantization parity tested.
- [ ] OOM recovery.
- [ ] Human bilingual review completed.

## H. Subtitle Lifecycle

- [ ] Provisional state.
- [ ] Final state.
- [ ] Monotonic revisions.
- [ ] Stable-prefix tests.
- [ ] Stale job coalescing.
- [ ] Final captions are terminal.
- [ ] Reading-duration logic.
- [ ] Low-confidence behavior avoids confident hallucination.

## I. Overlay

- [ ] Transparent.
- [ ] Topmost.
- [ ] Click-through in play mode.
- [ ] Non-activating.
- [ ] No focus stealing in repeated test.
- [ ] Edit mode.
- [ ] Global emergency toggle.
- [ ] Multi-monitor.
- [ ] Mixed DPI.
- [ ] Off-screen recovery.
- [ ] Borderless Windowed validation.
- [ ] Clearly third-party visual style.

## J. Performance

- [ ] p50/p95 latency report.
- [ ] CPU report.
- [ ] RAM report.
- [ ] GPU report.
- [ ] VRAM report.
- [ ] Queue-drop report.
- [ ] VALORANT average FPS comparison.
- [ ] VALORANT 1% low comparison.
- [ ] No sustained unacceptable frame-time degradation.
- [ ] Default profile meets agreed VRAM budget.

## K. Privacy and Security

- [ ] No cloud call in V1.
- [ ] No raw audio saved by default.
- [ ] No transcript history by default.
- [ ] No telemetry by default.
- [ ] Visible processing indicator.
- [ ] Content-free logs.
- [ ] Support bundle excludes content by default.
- [ ] Checksummed model supply chain.
- [ ] Safe model formats.
- [ ] Update signature plan.
- [ ] Voice-consent wording reviewed.

## L. Installer

- [ ] Clean Windows install works.
- [ ] No developer tooling required.
- [ ] Model manager works.
- [ ] Atomic model installation.
- [ ] Corrupt model rejected.
- [ ] Repair/remove models.
- [ ] Virtual cable is not silently bundled.
- [ ] Uninstall choices work.
- [ ] Sidecar exits cleanly.
- [ ] App binaries are signed for public release.

## M. Policy/Public Release

- [ ] Current Riot policy rechecked.
- [ ] Product registration/status resolved.
- [ ] Required disclaimer present.
- [ ] Branding reviewed.
- [ ] Model licenses reviewed.
- [ ] Virtual cable distribution rights reviewed.
- [ ] Privacy policy available.
- [ ] Support contact available.
- [ ] No unsupported claim of “perfect” translation.
