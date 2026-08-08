"""DS-100: regression tests for profile-to-source-mode routing.

These tests expose the current defect before the fix: unknown/auto
profiles silently fall back to Filipino, and only `chinese` diverges.
DS-101 implements the explicit mapping table that makes these pass.
"""

from __future__ import annotations

import pytest

from local_squad_inference.sidecar import profile_source_mode


def test_mandarin_maps_to_chinese() -> None:
    assert profile_source_mode("mandarin") == "chinese"


def test_chinese_maps_to_chinese_for_backward_compatibility() -> None:
    assert profile_source_mode("chinese") == "chinese"


def test_chinese_english_never_falls_back_to_filipino() -> None:
    mode = profile_source_mode("chinese_english")
    assert mode is not None
    assert mode != "filipino"


def test_filipino_family_maps_to_filipino() -> None:
    for profile in ("tagalog", "taglish", "cebuano", "bislish"):
        assert profile_source_mode(profile) == "filipino"


def test_auto_is_unconstrained_never_filipino() -> None:
    assert profile_source_mode("auto") is None


def test_unknown_profile_is_unconstrained() -> None:
    assert profile_source_mode("unknown-profile") is None


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        ("english", "english"),
        ("indonesian", "indonesian"),
        ("vietnamese", "vietnamese"),
        ("thai", "thai"),
        ("malay", "malay"),
    ],
)
def test_other_languages_map_explicitly(profile: str, expected: str) -> None:
    assert profile_source_mode(profile) == expected
