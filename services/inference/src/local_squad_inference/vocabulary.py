"""DS-800/801/802/804: generalized vocabulary, packs, hotwords, and
translation preservation. Data + pure logic; no provider changes."""

from __future__ import annotations

import re
from dataclasses import dataclass

# --- DS-800: generalized vocabulary entries ----------------------------------


@dataclass(frozen=True)
class VocabularyEntry:
    id: str
    canonicalText: str
    spokenVariants: tuple[str, ...] = ()
    languages: tuple[str, ...] = ("tl", "en")
    domains: tuple[str, ...] = ()
    protectedInTranslation: bool = False
    preferredTranslation: str | None = None
    enabled: bool = True


def adapt_glossary_entry(raw: dict[str, object]) -> VocabularyEntry:
    """Compatibility adapter: existing glossary shapes migrate
    deterministically instead of being deleted."""
    variants = raw.get("spoken_variants") or raw.get("aliases") or raw.get("variants")
    if isinstance(variants, str):
        variants = [variants]
    if not isinstance(variants, list):
        variants = []
    languages = raw.get("languages", ("tl", "en"))
    domains = raw.get("domains", ())
    if not isinstance(languages, list):
        languages = []
    if not isinstance(domains, list):
        domains = []
    return VocabularyEntry(
        id=str(raw.get("id") or raw.get("canonical_text") or ""),
        canonicalText=str(raw.get("canonical_text") or raw.get("term") or ""),
        spokenVariants=tuple(str(v) for v in variants if isinstance(v, str)),
        languages=tuple(str(lang) for lang in languages if isinstance(lang, str)),
        domains=tuple(str(d) for d in domains if isinstance(d, str)),
        protectedInTranslation=bool(raw.get("protected") or raw.get("preserve")),
        preferredTranslation=(
            str(raw["preferred_translation"]) if raw.get("preferred_translation") else None
        ),
        enabled=bool(raw.get("enabled", True)),
    )


# --- DS-801: vocabulary packs -------------------------------------------------

VALORANT_PACK: dict[str, VocabularyEntry] = {
    entry.id: entry
    for entry in [
        VocabularyEntry(
            "rush-b", "rush B", ("rush b", "rush bee"), ("tl", "en"), ("valorant",), True, "冲B点"
        ),
        VocabularyEntry(
            "rotate-a", "rotate A", ("rotate a",), ("tl", "en"), ("valorant",), True, "转A点"
        ),
        VocabularyEntry("plant", "plant", ("plant",), ("tl", "en"), ("valorant",), True, "安装"),
        VocabularyEntry("defuse", "defuse", ("defuse",), ("tl", "en"), ("valorant",), True, "拆除"),
        VocabularyEntry(
            "site-b", "B site", ("b site", "site b"), ("tl", "en"), ("valorant",), True, "B点"
        ),
    ]
}

VOCABULARY_PACKS: dict[str, dict[str, VocabularyEntry]] = {
    "valorant": VALORANT_PACK,
}


def merge_vocabulary(
    selected_packs: tuple[str, ...],
    custom_entries: dict[str, VocabularyEntry],
) -> dict[str, VocabularyEntry]:
    """Packs are disabled unless selected; custom entries override pack
    entries with conflicting ids."""
    merged: dict[str, VocabularyEntry] = {}
    for pack_id in selected_packs:
        merged.update(VOCABULARY_PACKS.get(pack_id, {}))
    merged.update(custom_entries)
    return {entry_id: entry for entry_id, entry in merged.items() if entry.enabled}


# --- DS-802: bounded hotword set ----------------------------------------------


def build_hotword_set(
    vocabulary: dict[str, VocabularyEntry],
    *,
    max_chars: int = 400,
    languages: tuple[str, ...] = ("tl", "en"),
    prefer_domains: tuple[str, ...] = ("valorant",),
) -> tuple[str, ...]:
    """Deduplicated, capped, domain-preferred hotwords. Out-of-language
    terms are excluded unless they are intentionally cross-lingual."""
    seen: set[str] = set()
    ordered: list[str] = []

    def push(term: str) -> bool:
        normalized = term.strip().lower()
        if not normalized or normalized in seen:
            return True
        if sum(len(item) for item in ordered) + len(normalized) > max_chars:
            return False
        seen.add(normalized)
        ordered.append(normalized)
        return True

    for entry_id in sorted(vocabulary):
        entry = vocabulary[entry_id]
        if entry.domains and not set(entry.domains) & set(prefer_domains):
            continue
        if entry.languages and not set(entry.languages) & set(languages):
            continue
        push(entry.canonicalText)
        for variant in entry.spokenVariants:
            if not push(variant):
                break
    # Cross-lingual terms still allowed if they fit.
    for entry in vocabulary.values():
        if entry.enabled and set(entry.languages) & set(languages):
            push(entry.canonicalText)
    return tuple(ordered)


# --- DS-804: preserve vocabulary through translation --------------------------

_PLACEHOLDER = "__YTSRL_{index}__"


def preserve_terms(text: str, vocabulary: dict[str, VocabularyEntry]) -> tuple[str, dict[str, str]]:
    """Replace protected terms with collision-safe placeholders before MT;
    returns (masked_text, placeholder -> original) for exact restoration."""
    protected = [entry for entry in vocabulary.values() if entry.protectedInTranslation]
    replacements: dict[str, str] = {}
    masked = text
    index = 0
    for entry in protected:
        terms = [entry.canonicalText, *entry.spokenVariants]
        for term in sorted(terms, key=len, reverse=True):
            pattern = re.compile(re.escape(term), re.IGNORECASE)
            if not pattern.search(masked):
                continue
            placeholder = _PLACEHOLDER.format(index=index)
            index += 1
            replacements[placeholder] = term
            masked = pattern.sub(placeholder, masked)
    return masked, replacements


def restore_terms(masked: str, replacements: dict[str, str]) -> str:
    restored = masked
    for placeholder, original in replacements.items():
        restored = restored.replace(placeholder, original)
    return restored
