"""Tactical error taxonomy (v0.4 Phase 0, BUILD_PLAN_V0_4 §9).

Error classes for annotating caption accuracy. Used by the Accuracy Lab and
the callout regression set so that "wrong number" and "wrong site" are
measurable categories, not vague impressions.

The taxonomy is a pure vocabulary: annotations are free-form `error` strings
that MUST be one of these categories (or empty for Correct). This keeps
reports machine-readable without ever needing transcript content.
"""

from __future__ import annotations

from typing import Literal

TacticalError = Literal[
    "correct",
    "mostly_correct",
    "wrong_language",
    "wrong_number",
    "wrong_site",
    "wrong_direction",
    "negation_reversed",
    "term_corrupted",
    "hallucination",
    "speech_omitted",
    "overlap_failure",
]

TACTICAL_ERRORS: tuple[TacticalError, ...] = (
    "correct",
    "mostly_correct",
    "wrong_language",
    "wrong_number",
    "wrong_site",
    "wrong_direction",
    "negation_reversed",
    "term_corrupted",
    "hallucination",
    "speech_omitted",
    "overlap_failure",
)

# Errors that are "safe" for tactical play (a wrong number/site/direction can
# flip a decision, so they are the critical classes).
CRITICAL_TACTICAL_ERRORS: frozenset[TacticalError] = frozenset(
    {
        "wrong_number",
        "wrong_site",
        "wrong_direction",
        "negation_reversed",
        "term_corrupted",
        "overlap_failure",
    }
)

# Human-readable labels (content-free, for the UI).
ERROR_LABELS: dict[str, str] = {
    "correct": "Correct",
    "mostly_correct": "Mostly correct",
    "wrong_language": "Wrong language",
    "wrong_number": "Wrong number",
    "wrong_site": "Wrong site",
    "wrong_direction": "Wrong direction",
    "negation_reversed": "Negation reversed",
    "term_corrupted": "Term corrupted",
    "hallucination": "Hallucination",
    "speech_omitted": "Speech omitted",
    "overlap_failure": "Overlap failure",
}


def is_tactical_error(value: str) -> bool:
    return value in TACTICAL_ERRORS


def is_critical(error: str) -> bool:
    return error in CRITICAL_TACTICAL_ERRORS


def error_label(error: str) -> str:
    label = ERROR_LABELS.get(error)
    return label if label is not None else "Unknown"
