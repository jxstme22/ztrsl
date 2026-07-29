# Phase 4 Validation Record

Date: 2026-07-30

Status: Fake-inference and authenticated loopback IPC implemented on macOS; Windows packaging
validation pending.

## Acceptance Criteria

- Bind the sidecar only to loopback on an ephemeral port.
- Generate a random token per launch and authenticate before accepting audio.
- Validate protocol versions, message sizes, schemas, and monotonic audio sequences.
- Use bounded binary audio messages and bounded WebSocket queues.
- Produce fake provisional and final captions without models.
- Supervise sidecar startup, crash detection, restart, and shutdown.
- Reject invalid tokens, repeated authentication, stale messages, and non-loopback peers.
- Surface recoverable sidecar failures in the UI.
- Send fake audio through the sidecar and caption reducer to the overlay.

## Implemented Evidence

- The Python sidecar binds to `127.0.0.1` only and independently verifies the peer address.
- The Rust supervisor reserves an ephemeral loopback port, generates a 256-bit launch token, passes
  it only in the child environment and authenticated hello, and never persists or logs it.
- Control messages are limited to 64 KiB and binary audio to 256 KiB.
- The binary header contains magic, protocol version, flags, 16-byte session ID, sequence,
  monotonic capture time, sample rate, channels, and sample count.
- Rust and Python independently encode/decode the same little-endian float32 audio format.
- Authentication uses constant-time token comparison and validates protocol compatibility.
- Stale/repeated sequences, invalid tokens, repeated hello, malformed payload lengths, oversized
  messages, and non-loopback peers are rejected.
- WebSocket receive queues are bounded at 16 messages.
- Fake VAD/ASR/MT produces a provisional caption followed by a higher-revision terminal final
  caption without loading models.
- The desktop runtime validates caption payloads again with Zod before updating the overlay.
- A sidecar crash produces a recoverable UI state; startup replaces an exited child.
- Normal shutdown sends an authenticated shutdown message, closes the socket, waits for the child,
  and kills it after a bounded timeout if necessary.

## Automated Evidence

- `pnpm test`: 22 tests passed across seven frontend files.
- `cargo test --workspace`: 26 normal Rust tests passed; two loopback process tests are tagged and
  skipped by the default suite.
- Both tagged Rust loopback tests were run explicitly and passed.
- `uv run pytest`: seven Python tests passed, including two live loopback WebSocket tests.
- Prettier, ESLint, strict TypeScript, rustfmt, Clippy with warnings denied, Ruff, and strict mypy
  all passed.
- `pnpm build` and the optimized `tauri build --no-bundle` passed.
- The optimized desktop process stayed running through startup and was terminated manually;
  macOS emitted workspace-service sandbox warnings but no application startup failure.
- Rust protocol tests cover version, control/audio size, binary roundtrip, malformed payload,
  token, loopback, repeated authentication, and stale sequence behavior.
- Python tests cover binary roundtrip, truncated payload, invalid token, and live WebSocket fake
  provisional/final output.
- The ignored loopback integration test was run explicitly and passed:
  Rust supervisor → Python process → authenticated WebSocket → binary audio → provisional/final
  captions → graceful shutdown.
- Crash detection and replacement startup are covered by a separate explicit loopback integration
  test.
- Frontend tests cover runtime schema rejection and fake sidecar output reaching the overlay.

## Deferred Windows 11 Evidence

- [ ] Bundled sidecar launches without a developer Python installation.
- [ ] Windows Defender/firewall does not expose or unexpectedly block loopback operation.
- [ ] A LAN connection attempt fails.
- [ ] Killing the packaged sidecar shows the recoverable UI and restart succeeds.
- [ ] Closing the desktop terminates the packaged sidecar.
- [ ] Rapid restart/reconnect remains bounded.
- [ ] Windows process CPU/RAM and fake roundtrip p50/p95 are recorded.
- [ ] No token, transcript text, or raw audio appears in default logs.

## Packaging Limitation

The current supervisor launches the project `.venv` or a developer Python executable and source
tree. It is suitable for development and protocol validation, not distribution. Bundling a frozen
or embedded sidecar is a later installer task and cannot be claimed complete here.

## Next Gate

Run the Windows checks above after the Phase 1–3 hardware gates. Do not begin Phase 5 model/VAD work
until the earlier Windows audio path is accepted.
