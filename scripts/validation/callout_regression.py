#!/usr/bin/env python3
"""Callout regression set (Phase 11, spec §17 matrix row "callouts").

Runs the Phase 7 language gate against a fixed set of short in-game callouts
(numbers, positions, rotate/rush commands) and asserts every one is ACCEPTED
(passed, tactical glossary, or short-callout protection) even under the
strictest profile/strictness. This is the decoder-free part of the callout
regression set; the hardware rows (real VB-CABLE + game audio) are documented
in docs/v0_3/PHASE_11_EVIDENCE.md and run on Windows 11.

Usage:
    .venv/bin/python scripts/validation/callout_regression.py
"""

from __future__ import annotations

import sys

from local_squad_inference.profiles import apply_language_gate

# (callout, strictness) — every row must pass the gate.
CALLOUTS: list[tuple[str, str]] = [
    ("rush B", "strict"),
    ("rotate A", "strict"),
    ("bomb planted", "strict"),
    ("defuse", "strict"),
    ("one on site", "strict"),
    ("push mid", "strict"),
    ("smoke B", "strict"),
    ("flash out", "strict"),
    ("A", "strict"),
    ("B", "strict"),
    ("3 2 1 go", "strict"),
    ("eco round", "strict"),
    ("ninja defuse", "strict"),
    ("ult ready", "strict"),
    ("hold the spike", "strict"),
    ("okay", "strict"),  # short-callout protection path
]

# Long/confident speech that is NOT a callout and is NOT in the profile
# language must be suppressed under strict — proves the gate is not just
# accepting everything.
REJECTED_UNDER_STRICT: list[tuple[str, str]] = [
    ("that was a really nice play", "tagalog"),
    ("let's talk about the economy", "mandarin"),
]


def main() -> int:
    failures = 0
    for callout, strictness in CALLOUTS:
        decision = apply_language_gate(
            "tagalog",
            strictness,
            source_text=callout,
            confidence=0.4,
            detected_language="en",
            utterance_duration_ms=600,
        )
        accepted = decision.applied in ("passed", "off")
        if not accepted:
            failures += 1
            print(f"FAIL  callout {callout!r}: {decision}")
        else:
            print(f"ok    callout {callout!r} -> {decision.applied} ({decision.reason})")

    for text, profile in REJECTED_UNDER_STRICT:
        decision = apply_language_gate(
            profile,
            "strict",
            source_text=text,
            confidence=0.9,
            detected_language="en",
            utterance_duration_ms=2000,
        )
        if decision.applied == "suppressed":
            print(f"ok    non-callout {text!r} suppressed under strict")
        else:
            failures += 1
            print(f"FAIL  non-callout {text!r}: {decision}")

    total = len(CALLOUTS) + len(REJECTED_UNDER_STRICT)
    print(f"\n{total - failures}/{total} callout-regression checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
