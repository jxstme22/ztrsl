"""Editable glossary and ASR corrections (v0.4 Phase 4, BUILD_PLAN_V0_4 §8).

A glossary entry fixes or protects terminology BEFORE translation:

- `preserve` — keep the exact term through translation (e.g. "Jett");
- `asr_correction` — replace a misheard ASR form with the correct one
  (e.g. "bind men" -> "B main");
- `preferred_translation` — force the English translation (e.g. "umiikot" ->
  "rotating");
- `alias` — map one term to another (variant spelling / short form).

Entries are scoped (global / source / profile / model) and hot-reloadable:
the glossary is evaluated per caption from the current rule set, so editing it
never requires a model restart. Protected placeholders survive translation by
being rewritten after MT.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Literal

GlossaryEntryType = Literal["preserve", "asr_correction", "preferred_translation", "alias"]
GlossaryScope = Literal["global", "source", "language_profile", "model"]

MAX_ENTRIES = 500
MAX_TERM_LENGTH = 64


@dataclass(frozen=True)
class GlossaryEntry:
    entry_type: GlossaryEntryType
    source: str
    target: str
    scope: GlossaryScope = "global"
    scope_key: str | None = None  # source id / profile id / model id
    note: str = ""


@dataclass(frozen=True)
class GlossaryCorrection:
    applied: bool
    corrected_text: str
    match: GlossaryEntry | None = None


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return " ".join(normalized.lower().split())


def _is_subsequence(needle: str, haystack: str) -> bool:
    """True when every token of `needle` appears in `haystack` in order."""
    tokens = needle.split()
    position = 0
    hay_tokens = haystack.split()
    for token in tokens:
        try:
            position = hay_tokens.index(token, position) + 1
        except ValueError:
            return False
    return True


class Glossary:
    def __init__(self, entries: list[GlossaryEntry] | None = None) -> None:
        self._entries: list[GlossaryEntry] = []
        for entry in entries or []:
            self.add(entry)

    def __len__(self) -> int:
        return len(self._entries)

    def add(self, entry: GlossaryEntry) -> None:
        if len(self._entries) >= MAX_ENTRIES:
            raise ValueError(f"too many glossary entries (max {MAX_ENTRIES})")
        if not entry.source or len(entry.source) > MAX_TERM_LENGTH:
            raise ValueError("glossary source must be 1..64 characters")
        if not entry.target or len(entry.target) > MAX_TERM_LENGTH:
            raise ValueError("glossary target must be 1..64 characters")
        self._entries.append(entry)

    def entries_for(
        self,
        *,
        source_id: str | None = None,
        profile_id: str | None = None,
        model_id: str | None = None,
    ) -> list[GlossaryEntry]:
        """Entries in applicability order: global first, then specific scopes
        (source, profile, model). A `scope_key=None` global entry always
        applies; scoped entries apply when their key matches."""
        ordered: list[GlossaryEntry] = []
        for entry in self._entries:
            if (
                entry.scope == "global"
                or (entry.scope == "source" and entry.scope_key == source_id)
                or (entry.scope == "language_profile" and entry.scope_key == profile_id)
                or (entry.scope == "model" and entry.scope_key == model_id)
            ):
                ordered.append(entry)
        return ordered

    def apply(
        self,
        text: str,
        *,
        source_id: str | None = None,
        profile_id: str | None = None,
        model_id: str | None = None,
    ) -> GlossaryCorrection:
        """Apply ASR corrections and alias rewrites to `text` (left-to-right,
        in applicability order). Returns the corrected text; if nothing
        changed, `applied` is False and text is unchanged."""
        corrected = text
        applied = False
        last_match: GlossaryEntry | None = None
        for entry in self.entries_for(
            source_id=source_id,
            profile_id=profile_id,
            model_id=model_id,
        ):
            if entry.entry_type not in {"asr_correction", "alias"}:
                continue
            if entry.source in corrected:
                corrected = corrected.replace(entry.source, entry.target)
                applied = True
                last_match = entry
        return GlossaryCorrection(applied=applied, corrected_text=corrected, match=last_match)

    def preserve_terms(self, text: str) -> list[str]:
        """Return preserve-type terms present in `text` (so callers can keep
        them intact across translation)."""
        normalized = _normalize(text)
        found: list[str] = []
        for entry in self._entries:
            if (
                entry.entry_type == "preserve"
                and entry.source
                and _is_subsequence(_normalize(entry.source), normalized)
            ):
                found.append(entry.source)
        return found

    def preferred_translation(self, source: str, english_text: str) -> str:
        """Return the preferred translation for `source` if one is defined
        (and its normalized form is in the source text), else the default."""
        normalized = _normalize(source)
        for entry in self._entries:
            if entry.entry_type == "preferred_translation" and _is_subsequence(
                entry.source, normalized
            ):
                return entry.target
        return english_text

    def to_json(self) -> list[dict[str, object]]:
        return [
            {
                "entry_type": entry.entry_type,
                "source": entry.source,
                "target": entry.target,
                "scope": entry.scope,
                "scope_key": entry.scope_key,
                "note": entry.note,
            }
            for entry in self._entries
        ]

    @classmethod
    def from_json(cls, payload: list[dict[str, object]]) -> Glossary:
        entries = [
            GlossaryEntry(
                entry_type=str(item["entry_type"]),  # type: ignore[arg-type]
                source=str(item["source"]),
                target=str(item["target"]),
                scope=str(item.get("scope", "global")),  # type: ignore[arg-type]
                scope_key=(str(item["scope_key"]) if item.get("scope_key") is not None else None),
                note=str(item.get("note", "")),
            )
            for item in payload
        ]
        return cls(entries)
