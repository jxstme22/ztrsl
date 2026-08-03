"""Language profiles and the strictness language gate (Phase 7, spec §6).

A language profile captures how a source is expected to speak: which ASR
language to force (or not), which languages are allowed to pass, whether
English terms may appear, and the recommended strictness. Strictness
(Off/Balanced/Strict) is chosen per source and applied per utterance at
the language gate, which stamps the caption's `filter_applied` /
`filter_reason` fields.

The gate is a pure function: it never touches decoders or queues. It only
CLASSIFIES an already-produced caption so the UI can hide/flag it. This is
what makes capability honesty possible — a decoder that cannot be locked
(post-filter) still gets its output classified, and the UI never claims
hard language locking for it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from typing import Literal

Strictness = Literal["off", "balanced", "strict"]
FilterApplied = Literal["off", "suppressed", "flagged", "passed"]

# Tokens that always pass the gate, even in Strict mode: numbers and short
# in-game callouts are typically spoken in English regardless of the profile
# ("A", "B", "rotate", "ninja"). Classified under the "valorant-core"
# glossary. A caption whose every token is in this set bypasses rejection.
TACTICAL_TERMS: frozenset[str] = frozenset(
    {
        "a",
        "b",
        "c",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "zero",
        "rotate",
        "rotating",
        "bomb",
        "spike",
        "site",
        "ninja",
        "flash",
        "smoke",
        "ult",
        "eco",
        "rush",
        "push",
        "hold",
        "holding",
        "plant",
        "planted",
        "defuse",
        "defusing",
        "mid",
        "out",
        "ready",
        "round",
        "going",
        "go",
        "on",
        "the",
        "in",
        "at",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "ok",
        "okay",
    }
)

GLOSSARIES: dict[str, frozenset[str]] = {
    "valorant-core": TACTICAL_TERMS,
    "chinese-english-gaming": frozenset(
        {
            *TACTICAL_TERMS,
            "aime",
            "bait",
            "camp",
            "boost",
            "carry",
            "gg",
            "gank",
        }
    ),
}

# Below this duration we refuse to suppress even in Strict mode: suppressing
# a 200 ms "rush" because it failed confidence is worse than the noise it
# might carry (spec §6.4 short-callout protection).
SHORT_CALLOUT_MS = 350

# A short callout is only suppressed (Strict) / flagged (Balanced) when its
# confidence is catastrophically low — far below the normal floor, so ordinary
# short utterances pass untouched.
SHORT_CALLOUT_MIN_CONFIDENCE = 0.2

# Confidence floor per strictness. Balanced only suppresses clearly-junk
# transcripts; Strict suppresses low-confidence output aggressively.
MIN_CONFIDENCE: dict[Strictness, float] = {"off": 0.0, "balanced": 0.25, "strict": 0.5}


@dataclass(frozen=True)
class LanguageProfile:
    profile_id: str
    forced_asr_language: str | None
    allowed_languages: tuple[str, ...]
    allow_english_terms: bool
    translation_target: str
    glossary_ids: tuple[str, ...]
    recommended_strictness: Strictness


@cache
def profile_catalog() -> dict[str, LanguageProfile]:
    """The spec §6.2 profile catalog. `forced_asr_language` uses Whisper
    ISO-639-1 tokens (cebuano has no whisper token, so cebuano/bislish force
    "tl" like the existing source modes). `allowed_languages` is how the gate
    classifies detected language, so it uses the same tokens the decoder
    reports."""
    common = ("valorant-core",)
    return {
        "tagalog": LanguageProfile(
            profile_id="tagalog",
            forced_asr_language="tl",
            allowed_languages=("tl",),
            allow_english_terms=False,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="balanced",
        ),
        "taglish": LanguageProfile(
            profile_id="taglish",
            forced_asr_language="tl",
            allowed_languages=("tl", "en"),
            allow_english_terms=True,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="balanced",
        ),
        "cebuano": LanguageProfile(
            profile_id="cebuano",
            forced_asr_language="tl",
            allowed_languages=("tl", "ceb"),
            allow_english_terms=False,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="balanced",
        ),
        "bislish": LanguageProfile(
            profile_id="bislish",
            forced_asr_language="tl",
            allowed_languages=("tl", "ceb", "en"),
            allow_english_terms=True,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="balanced",
        ),
        "mandarin": LanguageProfile(
            profile_id="mandarin",
            forced_asr_language="zh",
            allowed_languages=("zh",),
            allow_english_terms=False,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="balanced",
        ),
        "chinese_english": LanguageProfile(
            profile_id="chinese_english",
            forced_asr_language=None,
            allowed_languages=("zh", "en"),
            allow_english_terms=True,
            translation_target="en",
            glossary_ids=("valorant-core", "chinese-english-gaming"),
            recommended_strictness="balanced",
        ),
        "auto": LanguageProfile(
            profile_id="auto",
            forced_asr_language=None,
            allowed_languages=("tl", "ceb", "zh", "en"),
            allow_english_terms=True,
            translation_target="en",
            glossary_ids=common,
            recommended_strictness="off",
        ),
    }


def get_profile(profile_id: str) -> LanguageProfile:
    profile = profile_catalog().get(profile_id)
    if profile is None:
        # Unknown ids fall back to auto so a stale desktop registry cannot
        # brick a session.
        return profile_catalog()["auto"]
    return profile


@dataclass(frozen=True)
class GateDecision:
    applied: FilterApplied
    reason: str | None = None


def _text_tokens(text: str) -> tuple[str, ...]:
    lowered = text.lower()
    return tuple(token for token in lowered.split() if token)


def _is_tactical(text: str, profile: LanguageProfile) -> bool:
    tokens = _text_tokens(text)
    if not tokens:
        return False
    allowed: set[str] = set()
    for glossary_id in profile.glossary_ids:
        allowed.update(GLOSSARIES.get(glossary_id, ()))
    return all(token in allowed for token in tokens)


def apply_language_gate(
    profile_id: str,
    strictness: Strictness,
    *,
    source_text: str,
    confidence: float | None,
    detected_language: str | None = None,
    utterance_duration_ms: float | None = None,
) -> GateDecision:
    """Classify a transcript at the language gate (spec §6.4).

    Order of checks:
    1. Strictness Off accepts everything (`applied="off"`).
    2. Tactical glossary bypass: every token is a whitelisted callout, so it
       always `passed` regardless of strictness.
    3. Short callouts: below `SHORT_CALLOUT_MS` only a catastrophic
       confidence can suppress; otherwise they pass (never flag a "rush").
    4. Language mismatch: when a detected language is available and it is not
       in the profile's allowed set (English allowed via
       `allow_english_terms`), Balanced flags it and Strict suppresses it.
    5. Confidence floor: below the per-strictness minimum, Balanced flags,
       Strict suppresses.
    """
    if strictness == "off":
        return GateDecision(applied="off")
    profile = get_profile(profile_id)
    if not source_text:
        return GateDecision(applied="off")
    if _is_tactical(source_text, profile):
        return GateDecision(applied="passed", reason="tactical_glossary")

    min_conf = MIN_CONFIDENCE[strictness]
    if utterance_duration_ms is not None and utterance_duration_ms < SHORT_CALLOUT_MS:
        if confidence is not None and confidence < SHORT_CALLOUT_MIN_CONFIDENCE:
            return GateDecision(
                applied="suppressed" if strictness == "strict" else "flagged",
                reason="low_confidence_short",
            )
        return GateDecision(applied="passed", reason="short_callout")

    if detected_language is not None:
        allowed = set(profile.allowed_languages)
        if profile.allow_english_terms:
            allowed.add("en")
        if detected_language not in allowed:
            if strictness == "strict":
                return GateDecision(applied="suppressed", reason="language_mismatch")
            return GateDecision(applied="flagged", reason="language_mismatch")
        if detected_language == "en" and profile.allow_english_terms:
            # English-skip: English sources pass without being flagged; the
            # overlay still shows their (untranslated-directly) English text.
            return GateDecision(applied="passed", reason="english_terms")

    if confidence is not None and confidence < min_conf:
        return GateDecision(
            applied="suppressed" if strictness == "strict" else "flagged",
            reason="low_confidence",
        )
    return GateDecision(applied="passed")


def source_strictness(strictness: object) -> Strictness:
    return strictness if strictness in MIN_CONFIDENCE else "balanced"
