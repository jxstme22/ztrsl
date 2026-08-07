"""DS-706/DS-803: per-source context manager + bounded Whisper prompts.

Context is per source id and never crosses sources. Only final, confident,
allowed-language, non-hallucination text enters; provisional text never
does. Prompts are capped and reset per the documented rules.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from local_squad_inference.providers import is_hallucination

MAX_PROMPT_CHARS = 200
MAX_CONTEXT_ENTRIES = 6
LONG_SILENCE_RESET_MS = 30_000
MAX_REPETITION_RATIO = 0.6

CONFIDENCE_LIMIT = 0.5


@dataclass(frozen=True)
class ContextEntry:
    text: str
    confidence_category: str  # "high" | "low"
    language: str | None
    completed_at_ms: int


@dataclass
class SourceContext:
    source_id: str | None
    entries: list[ContextEntry] = field(default_factory=list)
    last_speech_at_ms: int = 0

    def reset(self) -> None:
        self.entries.clear()
        self.last_speech_at_ms = 0

    def add_final(
        self,
        *,
        text: str,
        confidence: float | None,
        language: str | None,
        allowed_languages: tuple[str, ...] = (),
    ) -> None:
        now_ms = int(time.monotonic() * 1000)
        if self.last_speech_at_ms and now_ms - self.last_speech_at_ms > LONG_SILENCE_RESET_MS:
            self.reset()
        self.last_speech_at_ms = now_ms
        cleaned = text.strip()
        if not cleaned:
            return
        if is_hallucination(cleaned):
            return
        if confidence is not None and confidence < CONFIDENCE_LIMIT:
            return
        if allowed_languages and language is not None and language not in allowed_languages:
            return
        if repetition_ratio(cleaned) >= MAX_REPETITION_RATIO:
            return
        self.entries.append(
            ContextEntry(
                text=cleaned,
                confidence_category="high" if (confidence or 0) >= 0.8 else "low",
                language=language,
                completed_at_ms=now_ms,
            )
        )
        del self.entries[:-MAX_CONTEXT_ENTRIES]


def repetition_ratio(text: str) -> float:
    tokens = text.lower().split()
    if len(tokens) < 3:
        return 0.0
    repeats = sum(1 for index in range(1, len(tokens)) if tokens[index] == tokens[index - 1])
    return repeats / len(tokens)


def build_whisper_prompt(
    context: SourceContext,
    *,
    glossary_terms: tuple[str, ...] = (),
    max_chars: int = MAX_PROMPT_CHARS,
) -> str:
    """Bounded prompt: recent context first, glossary terms appended when
    space allows. Provisional text never enters (only finals reach the
    context via `add_final`)."""
    parts: list[str] = []
    remaining = max_chars
    for entry in reversed(context.entries):
        piece = entry.text
        if len(piece) + (sum(len(part) for part in parts) + len(parts) + 1) > max_chars:
            break
        parts.append(piece)
        remaining -= len(piece) + 1
    terms = [term for term in glossary_terms if len(term) <= remaining]
    if terms:
        parts.append(" ".join(terms))
    return " ".join(reversed(parts)) if not terms else " ".join(parts)
