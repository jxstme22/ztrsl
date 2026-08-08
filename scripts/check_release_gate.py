"""DS-1005: automated subset of the v1.0 release gate.

Runs the canonical verification commands and reports pass/fail per gate.
Human-only gates (clean-machine, first-time tester) are listed for manual
confirmation.

Usage: python scripts/check_release_gate.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / ".venv" / "bin" / "python"
DESKTOP = ROOT / "apps" / "desktop"

SRC = "services/inference/src"
TESTS = "services/inference/tests"
PYTESTS = [str(PYTHON), "-m", "pytest", "services/inference/tests", "-q"]
MYPY = [str(PYTHON), "-m", "mypy", SRC, TESTS]
RUFF_CHECK = [str(PYTHON), "-m", "ruff", "check", SRC, TESTS]
RUFF_FORMAT = [str(PYTHON), "-m", "ruff", "format", "--check", SRC, TESTS]

GATES: list[tuple[str, list[str]]] = [
    ("python tests", PYTESTS),
    ("python typing", MYPY),
    ("python lint", RUFF_CHECK),
    ("python format", RUFF_FORMAT),
    ("rust tests", ["cargo", "test", "--workspace"]),
    ("desktop tests", ["pnpm", "vitest", "run"]),
    ("typecheck", ["pnpm", "typecheck"]),
    ("lint", ["pnpm", "lint"]),
]


def main() -> int:
    failures = 0
    for name, command in GATES:
        cwd = ROOT if name.startswith("python") or name.startswith("rust") else DESKTOP
        print(f"== {name}")
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
        ok = result.returncode == 0
        print("PASS" if ok else f"FAIL (exit {result.returncode})")
        if not ok:
            failures += 1
            tail = (result.stdout + result.stderr).strip().splitlines()[-8:]
            for line in tail:
                print("   ", line)
    print(f"\n{'ALL GATES PASS' if failures == 0 else f'{failures} GATE(S) FAILED'}")
    print("Manual gates (not automated): clean-machine matrices, VB-CABLE")
    print("first-time setup, benchmark results, documentation currency.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
