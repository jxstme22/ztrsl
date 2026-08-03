"""v0.4 Phase 0: tactical error taxonomy tests."""

from local_squad_inference.evaluation.taxonomy import (
    CRITICAL_TACTICAL_ERRORS,
    ERROR_LABELS,
    TACTICAL_ERRORS,
    error_label,
    is_critical,
    is_tactical_error,
)


def test_all_errors_have_labels() -> None:
    assert set(TACTICAL_ERRORS) == set(ERROR_LABELS)


def test_critical_set_is_subset() -> None:
    assert set(TACTICAL_ERRORS) >= CRITICAL_TACTICAL_ERRORS


def test_gameplay_critical_classes_present() -> None:
    for error in ("wrong_number", "wrong_site", "wrong_direction", "negation_reversed"):
        assert is_critical(error)
    assert is_critical("overlap_failure")
    assert not is_critical("correct")
    assert not is_critical("hallucination")


def test_unknown_values_rejected() -> None:
    assert not is_tactical_error("not-a-real-error")


def test_labels_are_content_free() -> None:
    for label in ERROR_LABELS.values():
        assert label and label.strip()


def test_error_label_falls_back() -> None:
    assert error_label("nope") == "Unknown"
