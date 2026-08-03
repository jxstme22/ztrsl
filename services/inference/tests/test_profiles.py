"""Phase 7 language gate matrix tests (spec §6). Pure, no models, no I/O."""

import pytest

from local_squad_inference.profiles import (
    SHORT_CALLOUT_MS,
    apply_language_gate,
    get_profile,
    profile_catalog,
    source_strictness,
)


def test_catalog_has_all_required_profiles() -> None:
    required = {
        "tagalog",
        "taglish",
        "cebuano",
        "bislish",
        "mandarin",
        "chinese_english",
        "auto",
    }
    assert required <= set(profile_catalog())
    for profile_id in required:
        profile = get_profile(profile_id)
        assert profile.translation_target == "en"


def test_off_accepts_everything() -> None:
    for profile_id, kwargs in (
        ("tagalog", dict(detected_language="en", confidence=0.001)),
        ("mandarin", dict(detected_language="en", confidence=0.01)),
        ("auto", dict(detected_language="fil", confidence=0.05)),
    ):
        decision = apply_language_gate(
            profile_id,
            "off",
            source_text="whatever foreign speech",
            **kwargs,
        )
        assert decision.applied == "off"
        assert decision.reason is None


def test_tactical_glossary_bypasses_even_strict() -> None:
    # "rush B" is all whitelisted tokens: never suppressed, even with junk
    # confidence in Strict mode.
    for strictness in ("balanced", "strict"):
        decision = apply_language_gate(
            "mandarin",
            strictness,
            source_text="rush B",
            confidence=0.01,
            detected_language="en",
            utterance_duration_ms=400,
        )
        assert decision.applied == "passed"
        assert decision.reason == "tactical_glossary"


def test_short_callout_passes_in_less_strict_modes() -> None:
    decision = apply_language_gate(
        "mandarin",
        "balanced",
        source_text="okay",
        confidence=0.3,
        utterance_duration_ms=200,
    )
    assert decision.applied == "passed"
    assert decision.reason == "short_callout"


@pytest.mark.parametrize("strictness", ["balanced", "strict"])
def test_short_callout_only_suppresses_on_catastrophic_confidence(strictness) -> None:
    decision = apply_language_gate(
        "mandarin",
        strictness,
        source_text="okay",
        confidence=0.05,
        utterance_duration_ms=150,
    )
    expected = "suppressed" if strictness == "strict" else "flagged"
    assert decision.applied == expected
    assert decision.reason == "low_confidence_short"


def test_shorter_than_threshold_uses_short_callout_branch() -> None:
    decision = apply_language_gate(
        "auto",
        "strict",
        source_text="coffee please",
        confidence=0.55,
        utterance_duration_ms=SHORT_CALLOUT_MS - 1,
    )
    assert decision.applied == "passed"
    assert decision.reason == "short_callout"


def test_language_mismatch_flagged_balanced_suppressed_strict() -> None:
    common = dict(
        source_text="das ist ein test",
        confidence=0.9,
        detected_language="de",
        utterance_duration_ms=1200,
    )
    balanced = apply_language_gate("mandarin", "balanced", **common)
    assert balanced.applied == "flagged"
    assert balanced.reason == "language_mismatch"
    strict = apply_language_gate("mandarin", "strict", **common)
    assert strict.applied == "suppressed"
    assert strict.reason == "language_mismatch"


def test_english_terms_skip_when_allowed() -> None:
    decision = apply_language_gate(
        "taglish",
        "strict",
        source_text="let's go",
        confidence=0.9,
        detected_language="en",
        utterance_duration_ms=1200,
    )
    assert decision.applied == "passed"
    assert decision.reason == "english_terms"


def test_english_rejected_when_profile_does_not_allow() -> None:
    decision = apply_language_gate(
        "tagalog",
        "balanced",
        source_text="hello friend",
        confidence=0.95,
        detected_language="en",
        utterance_duration_ms=1200,
    )
    assert decision.applied == "flagged"
    assert decision.reason == "language_mismatch"


def test_confidence_floor_flags_balanced_suppresses_strict() -> None:
    common = dict(
        source_text="maayong adlaw",
        confidence=0.15,
        detected_language="ceb",
        utterance_duration_ms=1200,
    )
    balanced = apply_language_gate("cebuano", "balanced", **common)
    assert balanced.applied == "flagged"
    assert balanced.reason == "low_confidence"
    strict = apply_language_gate("cebuano", "strict", **common)
    assert strict.applied == "suppressed"
    assert strict.reason == "low_confidence"


def test_high_confidence_matching_language_passes() -> None:
    decision = apply_language_gate(
        "cebuano",
        "balanced",
        source_text="maayong adlaw",
        confidence=0.9,
        detected_language="ceb",
        utterance_duration_ms=1200,
    )
    assert decision.applied == "passed"
    assert decision.reason is None


def test_confidence_only_gate_without_language_signal() -> None:
    # No detected language (the current wire reality): only confidence and
    # duration drive the decision.
    bad = apply_language_gate(
        "tagalog",
        "strict",
        source_text="some noisy transcript",
        confidence=0.1,
        utterance_duration_ms=1200,
    )
    assert bad.applied == "suppressed"
    assert bad.reason == "low_confidence"
    good = apply_language_gate(
        "tagalog",
        "strict",
        source_text="some noisy transcript",
        confidence=0.9,
        utterance_duration_ms=1200,
    )
    assert good.applied == "passed"


def test_empty_text_never_considered_a_mismatch() -> None:
    decision = apply_language_gate(
        "tagalog",
        "strict",
        source_text="",
        confidence=0.0,
        detected_language="en",
    )
    assert decision.applied == "off"


def test_unknown_profile_falls_back_to_auto() -> None:
    decision = apply_language_gate(
        "definitely-not-a-profile",
        "balanced",
        source_text="kumusta",
        confidence=0.9,
        utterance_duration_ms=1200,
    )
    # auto is off-recommended but the caller picked balanced, so the gate
    # still classifies.
    assert decision.applied in ("passed", "flagged", "suppressed")


def test_source_strictness_normalizes_invalid_values() -> None:
    assert source_strictness("off") == "off"
    assert source_strictness("balanced") == "balanced"
    assert source_strictness("strict") == "strict"
    assert source_strictness("turbo") == "balanced"
