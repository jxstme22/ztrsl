"""Per-source phrase filters (v0.4 Phase 3, BUILD_PLAN_V0_4 §7).

Filters drop or transform phrases BEFORE the language gate and translation,
so filtered content never reaches MT or the overlay. Rules are per-source and
support four match modes:

- `exact`    — normalized equality;
- `contains` — substring;
- `similar`  — normalized token similarity against a threshold (fuzzy);
- `regex`    — regular expression.

Processing order (spec §7): ASR -> normalize -> phrase filters -> language gate
-> glossary correction -> translation -> overlay.

Phrase filters are a customization/fallback for known noise (e.g. "user joined
your channel"), NOT the main solution for game audio — routing isolation is.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

PhraseMatchMode = Literal["exact", "contains", "similar", "regex"]

# Similarity threshold for `similar` mode; below this it's not a match.
DEFAULT_SIMILARITY_THRESHOLD = 0.87

# Hard safety limits (spec §7).
MAX_RULES = 200
MAX_PATTERN_LENGTH = 256


@dataclass(frozen=True)
class PhraseFilterRule:
    source_id: str
    text: str
    match_mode: PhraseMatchMode = "exact"
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    enabled: bool = True


@dataclass(frozen=True)
class PhraseFilterResult:
    matched: bool
    rule: PhraseFilterRule | None = None
    match_mode: PhraseMatchMode | None = None


def _normalize(text: str) -> str:
    """Lowercase, NFKC-normalize, and collapse whitespace."""
    normalized = unicodedata.normalize("NFKC", text)
    return " ".join(normalized.lower().split())


def _tokenize(text: str) -> set[str]:
    return set(_normalize(text).split())


def _similarity(left: str, right: str) -> float:
    """Jaccard similarity over normalized token sets."""
    left_tokens = _tokenize(left)
    right_tokens = _tokenize(right)
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = left_tokens & right_tokens
    union = left_tokens | right_tokens
    return len(intersection) / len(union)


def rule_matches(rule: PhraseFilterRule, text: str) -> bool:
    """Test one rule against raw text. Regex uses `re.search` on the
    normalized text; other modes compare normalized forms."""
    if not rule.enabled:
        return False
    normalized = _normalize(text)
    target = _normalize(rule.text)
    if not target:
        return False
    if rule.match_mode == "exact":
        return normalized == target
    if rule.match_mode == "contains":
        return target in normalized
    if rule.match_mode == "similar":
        return _similarity(normalized, target) >= rule.threshold
    # regex
    try:
        return re.search(rule.text, normalized) is not None
    except re.error:
        return False


class PhraseFilterSet:
    """A per-source set of rules with evaluation and validation."""

    def __init__(self, rules: list[PhraseFilterRule] | None = None) -> None:
        self._rules: list[PhraseFilterRule] = []
        for rule in rules or []:
            self.add(rule)

    def __len__(self) -> int:
        return len(self._rules)

    def add(self, rule: PhraseFilterRule) -> None:
        if len(self._rules) >= MAX_RULES:
            raise ValueError(f"too many phrase filters (max {MAX_RULES})")
        if not rule.text or len(rule.text) > MAX_PATTERN_LENGTH:
            raise ValueError("phrase filter text must be 1..256 characters")
        if rule.match_mode == "regex":
            try:
                re.compile(rule.text)
            except re.error as error:
                raise ValueError(f"invalid regex: {error}") from error
        self._rules.append(rule)

    def for_source(self, source_id: str) -> list[PhraseFilterRule]:
        return [rule for rule in self._rules if rule.source_id == source_id]

    def evaluate(self, text: str, source_id: str) -> PhraseFilterResult:
        """First matching rule for `source_id`, or no match."""
        for rule in self.for_source(source_id):
            if rule_matches(rule, text):
                return PhraseFilterResult(matched=True, rule=rule, match_mode=rule.match_mode)
        return PhraseFilterResult(matched=False)

    def to_json(self) -> list[dict[str, object]]:
        return [
            {
                "source_id": rule.source_id,
                "text": rule.text,
                "match_mode": rule.match_mode,
                "threshold": rule.threshold,
                "enabled": rule.enabled,
            }
            for rule in self._rules
        ]

    @classmethod
    def from_json(cls, payload: list[dict[str, object]]) -> PhraseFilterSet:
        rules: list[PhraseFilterRule] = []
        for item in payload:
            rules.append(
                PhraseFilterRule(
                    source_id=str(item["source_id"]),
                    text=str(item["text"]),
                    match_mode=str(item.get("match_mode", "exact")),  # type: ignore[arg-type]
                    threshold=float(item.get("threshold", DEFAULT_SIMILARITY_THRESHOLD)),
                    enabled=bool(item.get("enabled", True)),
                )
            )
        return cls(rules)
