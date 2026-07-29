# Risk Register

| ID | Risk | Probability | Impact | Mitigation | Exit Signal |
|---|---|---:|---:|---|---|
| R-001 | Cebuano conversational ASR is weak | High | High | native-speaker corpus, compare 300M/1B, glossary, adaptation later | critical error rate meets agreed gate |
| R-002 | Code-switching damages translation | High | High | protect English terms, source modes, mixed benchmark | mixed-speech score passes |
| R-003 | Virtual cable setup confuses users | High | Medium | setup wizard, meter, silence test, screenshots later | first-run completion rate acceptable |
| R-004 | Monitoring adds noticeable delay | Medium | High | native-format branch, small bounded buffers, WASAPI event mode | measured delay acceptable |
| R-005 | Feedback loop causes loud audio | Medium | High | topology validation, auto-mute guard, volume ramp | feedback tests pass |
| R-006 | Overlay steals focus/input | Medium | Critical | click-through/no-activate, focus tests, emergency hotkey | zero focus steals in test matrix |
| R-007 | Overlay hidden in fullscreen | High | Medium | support Borderless Windowed only in V1 | limitation clearly handled |
| R-008 | GPU contention hurts gameplay | High | High | 300M default, batch 1, profiles, benchmark | frame-time gate passes |
| R-009 | Translation model exceeds VRAM | Medium | High | quantization, CPU offload, lower profile, OOM recovery | no crash; fallback works |
| R-010 | Model artifact license/redistribution issue | Medium | High | legal manifest, separate download, review | approved distribution plan |
| R-011 | Virtual cable cannot be redistributed | High | Medium | user installs official signed driver separately | setup supports external install |
| R-012 | Anti-cheat/user trust concern | Medium | Critical | external-only, signed app, documentation, registration | policy review complete |
| R-013 | Voice privacy concern | Medium | High | local-only, no recording, visible indicator | privacy review complete |
| R-014 | Sidecar packaging is fragile | Medium | High | health protocol, restart, clean-machine CI, native roadmap | install tests pass |
| R-015 | Model hallucination changes tactical meaning | Medium | Critical | uncertainty UX, critical-error benchmark, omit low confidence | critical rate below gate |
| R-016 | Overlapping speakers fail | High | Medium | declare V1 limitation, avoid false names | documented and tested |
| R-017 | Device invalidation crashes capture | Medium | Medium | notification handling, bounded reconnect | churn test passes |
| R-018 | Bluetooth profile degrades audio | Medium | Medium | detect/warn, recommend stereo path | support article and fallback |
| R-019 | Model downloads are compromised | Low | Critical | HTTPS, pinned hashes, safe formats | checksum/rejection tests pass |
| R-020 | Logs leak conversations | Low | High | content-free logs by default, tests | privacy log audit passes |

## Risk Review Cadence

Review at every milestone and before any public build.

A critical risk with no active mitigation blocks release.
