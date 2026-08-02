# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report privately
instead so we can fix and release before details are public.

**How to report**

- GitHub private vulnerability reporting: use the "Report a vulnerability"
  button on the repository's Security tab (there is a report dedicated
  area: https://github.com/<owner>/<repo>/security/advisories/new).
- If that is not available, email the maintainer (address appears in the
  repository profile / release notes) with the subject
  `[SECURITY] <summary>`.

Include:

- the affected version / commit;
- a minimal description of the vulnerability and its impact;
- steps to reproduce (no live exploit code needed);
- any suggested fix, if known.

You should receive an acknowledgement within 3 business days, and we will work
on a fix with a coordinated disclosure timeline.

## Security model

- **Only ordinary OS audio APIs** are used. No game-process access, memory
  reads, packet interception, input automation, or kernel components — by
  design.
- **Loopback-only IPC** between the Rust host and the Python sidecar, with a
  random per-launch token and constant-time comparison.
- **No telemetry, no analytics, no auto-download** of models: network use is
  limited to (a) model downloads from pinned public URLs at the user's
  explicit request, and (b) opt-in HTTP translation providers that receive
  only recognized **text**, never audio.
- **No raw audio persistence** unless the user explicitly enables diagnostic
  recording.
- **Bounded queues everywhere** to keep adversarial input from exhausting
  memory; strict Pydantic/zod validation on every IPC payload.
- **Model integrity**: downloads are pinned to exact revisions with committed
  SHA-256 checksums, staged atomically, and verified before install.

## Scope

In scope: the Rust crates, the Tauri desktop app, the Python inference
sidecar, and the model download/install pipeline.

Out of scope: the correctness or security of third-party Valoran/VALORANT
clients, the game itself, or models you add yourself. (Model artifacts carry
their own licenses and are not covered by this project's Apache-2.0 license.)

## Supported versions

Security fixes are backported to the latest release plus, where practical, the
most recent previous minor version. Development (unreleased) code is not
official support.

## Known areas to harden before 1.0

These are tracked as open work, not as active vulnerabilities:

- Opt-in HTTP-provider API keys currently live in the webview's localStorage
  (plaintext); the plan is to move them to the OS keychain.
- First-run model downloads use plain HTTPS GETs to pinned URLs; a GitHub
  Releases mirror with signed manifests is planned for stronger supply-chain
  guarantees.
