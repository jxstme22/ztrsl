"""v0.4 Phase 3: phrase filter tests."""

import pytest

from local_squad_inference.phrase_filters import (
    PhraseFilterRule,
    PhraseFilterSet,
    rule_matches,
)

DISCORD = "22222222222222222222222222222222"
TEAM = "11111111111111111111111111111111"


def test_exact_mode_ignores_case_and_whitespace() -> None:
    rule = PhraseFilterRule(source_id=DISCORD, text="user joined your channel", match_mode="exact")
    assert rule_matches(rule, "User Joined Your   Channel")
    assert rule_matches(rule, "  user joined your channel  ")
    assert not rule_matches(rule, "user left the channel")


def test_contains_mode() -> None:
    rule = PhraseFilterRule(source_id=DISCORD, text="joined your channel", match_mode="contains")
    assert rule_matches(rule, "sarah joined your channel")
    assert not rule_matches(rule, "sarah left the channel")


def test_similar_mode_matches_fuzzy_variants() -> None:
    rule = PhraseFilterRule(
        source_id=DISCORD,
        text="user joined the channel",
        match_mode="similar",
        threshold=0.6,
    )
    assert rule_matches(rule, "user joind the channel")
    assert not rule_matches(rule, "completely unrelated")


def test_regex_mode() -> None:
    rule = PhraseFilterRule(
        source_id=DISCORD,
        text=r"^\d+ members? (joined|left)$",
        match_mode="regex",
    )
    assert rule_matches(rule, "3 members joined")
    assert not rule_matches(rule, "nobody joined")


def test_invalid_regex_rejected_at_add() -> None:
    rules = PhraseFilterSet()
    with pytest.raises(ValueError):
        rules.add(PhraseFilterRule(source_id=DISCORD, text="([unclosed", match_mode="regex"))


def test_disabled_rules_never_match() -> None:
    rule = PhraseFilterRule(source_id=DISCORD, text="noise", enabled=False)
    assert not rule_matches(rule, "noise")


def test_set_scopes_rules_per_source() -> None:
    rules = PhraseFilterSet(
        [
            PhraseFilterRule(source_id=DISCORD, text="joined", match_mode="contains"),
            PhraseFilterRule(source_id=TEAM, text="rotated", match_mode="contains"),
        ]
    )
    assert rules.evaluate("someone joined", DISCORD).matched
    assert not rules.evaluate("someone joined", TEAM).matched
    assert rules.evaluate("we rotated", TEAM).matched


def test_set_returns_first_match_and_mode() -> None:
    rules = PhraseFilterSet(
        [
            PhraseFilterRule(source_id=DISCORD, text="a", match_mode="exact"),
            PhraseFilterRule(source_id=DISCORD, text="b", match_mode="contains"),
        ]
    )
    result = rules.evaluate("b is here", DISCORD)
    assert result.matched
    assert result.match_mode == "contains"


def test_set_limits_and_lengths() -> None:
    rules = PhraseFilterSet()
    with pytest.raises(ValueError):
        rules.add(PhraseFilterRule(source_id=DISCORD, text=""))
    with pytest.raises(ValueError):
        rules.add(PhraseFilterRule(source_id=DISCORD, text="x" * 300))


def test_json_roundtrip() -> None:
    rules = PhraseFilterSet(
        [
            PhraseFilterRule(source_id=DISCORD, text="joined", match_mode="contains"),
            PhraseFilterRule(source_id=TEAM, text="rotated", match_mode="exact", enabled=False),
        ]
    )
    restored = PhraseFilterSet.from_json(rules.to_json())
    assert len(restored) == 2
    assert restored.evaluate("someone joined", DISCORD).matched
    assert not restored.evaluate("we rotated", TEAM).matched  # disabled preserved
