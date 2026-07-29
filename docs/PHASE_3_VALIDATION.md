# Phase 3 Validation Record

Date: 2026-07-30

Status: Portable routing slice implemented on macOS; Windows capture/playback backend and hardware
acceptance pending.

## Acceptance Criteria

- Forward captured voice to a user-selected physical output.
- Keep monitoring independent from inference.
- Provide monitor volume without modifying monitoring channels unnecessarily.
- Create a separate 16 kHz mono inference branch with streaming resampling.
- Block obvious feedback configurations.
- Count monitor/inference overflow, monitor underrun, and clipping.
- Keep all queues and memory bounded during long operation.
- Provide routing-test UI and deterministic shutdown.

## Implemented Evidence

- `AudioRouter` branches every worker-owned frame into independent bounded monitoring and
  inference queues.
- Monitoring retains the native format; volume gain and clamping occur only when dequeuing for the
  monitor.
- The inference branch downmixes channels and uses a stateful streaming linear resampler to
  16 kHz mono.
- Resampler tests cover 44.1, 48, and 96 kHz input and preserve duration across chunk boundaries.
- Capture and playback using the same stable endpoint ID are rejected.
- Overflow, underrun, clipped-frame, captured-frame, and inference-drop counters are content-free.
- A 5,000-frame synthetic stress test proves monitor depth remains at 8 and inference depth at 100.
- The routing UI requires explicit capture and playback selections, exposes volume and live
  metrics, and states that the macOS path is synthetic.
- Synthetic source, router, and monitor stop deterministically.

## Automated Evidence

- Audio-core has 13 passing tests, including six Phase 3 routing/resampling/feedback/stress tests.
- The 5,000-frame stress test completed in 0.16 seconds as part of the Rust suite; this is a
  boundedness diagnostic, not a substitute for the two-hour real-time Windows soak.
- 44.1, 48, and 96 kHz streaming resampling tests finish within two samples of the expected
  one-second 16 kHz duration.
- Frontend routing selection and active-state behavior pass in the model-free test suite.
- Audio, IPC, and supervisor crates pass Windows MSVC cross-check and Clippy from macOS.

## Deferred Windows 11 Evidence

- [ ] Implement and compile the event-driven WASAPI frame-capture worker.
- [ ] Implement and compile shared-mode WASAPI playback to the selected render endpoint.
- [ ] Selected virtual-cable voice is audible through selected headphones.
- [ ] Monitoring works while fake/model inference is disabled.
- [ ] Game audio remains routed directly to physical headphones.
- [ ] Monitor volume changes smoothly without clipping.
- [ ] Capture and playback endpoint formats negotiate correctly.
- [ ] Device invalidation stops only the affected audio client and is recoverable.
- [ ] Feedback suspicion auto-mutes monitoring and requires confirmation.
- [ ] USB, analog, and Bluetooth output behavior is recorded.
- [ ] Two-hour soak demonstrates bounded memory and queue depths.
- [ ] CPU, RAM, audio latency, underruns, overflows, GPU, and VRAM are recorded.

## Safety and Privacy

No raw audio is written to disk. No monitoring API is active on macOS; the development monitor is
an in-memory bounded sink. The design uses no game process, file, memory, network-packet, graphics,
input-automation, anti-cheat, kernel, or screen-analysis capability.

## Next Gate

Finish the Windows WASAPI capture/playback backend and the checklist above. Phase 4 development was
authorized early by ADR-010, but Phase 5 must wait for the deferred Windows acceptance work.
