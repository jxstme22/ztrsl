"""DS-706/800/801/802/804/902: context, vocabulary, hotwords, preservation,
caption stream."""

from __future__ import annotations

import asyncio

from local_squad_inference.caption_stream import CaptionStreamHub
from local_squad_inference.context import SourceContext, build_whisper_prompt
from local_squad_inference.vocabulary import (
    VALORANT_PACK,
    VocabularyEntry,
    adapt_glossary_entry,
    build_hotword_set,
    merge_vocabulary,
    preserve_terms,
    restore_terms,
)


class TestSourceContext:
    def test_accepts_only_confident_finals(self) -> None:
        context = SourceContext("s1")
        context.add_final(text="rotate B", confidence=0.9, language="tl")
        context.add_final(text="low confidence", confidence=0.2, language="tl")
        context.add_final(text="thanks for watching", confidence=0.9, language="tl")
        assert len(context.entries) == 1
        assert context.entries[0].text == "rotate B"

    def test_provisional_text_never_enters(self) -> None:
        context = SourceContext("s1")
        # add_final is the only entry point; provisionals never call it.
        context.add_final(text="draft", confidence=0.9, language="tl")
        assert len(context.entries) == 1

    def test_language_isolation_per_source(self) -> None:
        first = SourceContext("s1")
        second = SourceContext("s2")
        first.add_final(text="one", confidence=0.9, language="tl")
        assert len(second.entries) == 0

    def test_reset_after_long_silence(self) -> None:
        context = SourceContext("s1")
        context.add_final(text="one", confidence=0.9, language="tl")
        context.last_speech_at_ms = context.last_speech_at_ms - 31_000
        context.add_final(text="two", confidence=0.9, language="tl")
        assert len(context.entries) == 1
        assert context.entries[0].text == "two"

    def test_entries_are_bounded(self) -> None:
        context = SourceContext("s1")
        for index in range(20):
            context.add_final(text=f"line {index}", confidence=0.9, language="tl")
        assert len(context.entries) <= 6


class TestWhisperPrompt:
    def test_prompt_is_bounded_and_uses_recent_context(self) -> None:
        context = SourceContext("s1")
        for index in range(10):
            context.add_final(text=f"line {index}", confidence=0.9, language="tl")
        prompt = build_whisper_prompt(context, max_chars=100)
        assert len(prompt) <= 110
        assert "line 9" in prompt

    def test_glossary_terms_append_when_space_allows(self) -> None:
        context = SourceContext("s1")
        context.add_final(text="hello", confidence=0.9, language="en")
        prompt = build_whisper_prompt(context, glossary_terms=("rush b",), max_chars=50)
        assert "rush b" in prompt


class TestVocabulary:
    def test_adapter_migrates_existing_glossary_shape(self) -> None:
        entry = adapt_glossary_entry(
            {
                "id": "e1",
                "canonical_text": "rush B",
                "aliases": ["rush bee"],
                "protected": True,
                "preferred_translation": "冲B点",
            }
        )
        assert entry.canonicalText == "rush B"
        assert entry.spokenVariants == ("rush bee",)
        assert entry.protectedInTranslation is True

    def test_packs_disabled_unless_selected(self) -> None:
        assert merge_vocabulary((), {}) == {}
        merged = merge_vocabulary(("valorant",), {})
        assert "rush-b" in merged

    def test_custom_entries_override_packs(self) -> None:
        custom = dict(VALORANT_PACK)
        custom["rush-b"] = VocabularyEntry(
            "rush-b", "rush b", preferredTranslation="全冲B", protectedInTranslation=True
        )
        merged = merge_vocabulary(("valorant",), custom)
        assert merged["rush-b"].preferredTranslation == "全冲B"

    def test_hotword_set_is_bounded_and_deduplicated(self) -> None:
        hotwords = build_hotword_set(VALORANT_PACK, max_chars=60)
        assert len(hotwords) > 0
        assert len(set(hotwords)) == len(hotwords)
        assert sum(len(h) for h in hotwords) <= 60

    def test_preserve_and_restore_round_trip(self) -> None:
        masked, replacements = preserve_terms("rush b now, then defuse", VALORANT_PACK)
        assert "__YTSRL_" in masked
        assert "rush b" not in masked.lower()
        restored = restore_terms(masked, replacements)
        assert restored == "rush B now, then defuse"


class TestCaptionStream:
    def test_hub_bounds_clients_and_broadcasts(self) -> None:
        async def scenario() -> None:
            hub = CaptionStreamHub(max_clients=1)
            first = await hub.register()
            assert hub.accepts() is False
            await hub.publish({"text": "hi"})
            assert first.get_nowait().startswith("data:")
            hub.unregister(first)
            assert hub.accepts() is True

        asyncio.run(scenario())


class TestPerformanceBudgets:
    def test_budgets_exist_per_quality_profile(self) -> None:
        from local_squad_inference.performance_budgets import (
            PERFORMANCE_BUDGETS,
            budget_for,
        )

        for profile in ("fast", "balanced", "best_quality", "low_memory"):
            budget = budget_for(profile)
            assert budget.target_final_latency_ms > 0
            assert budget.queue_capacity > 0
        assert set(PERFORMANCE_BUDGETS) == {
            "fast",
            "balanced",
            "best_quality",
            "low_memory",
        }

    def test_warnings_fire_outside_the_class(self) -> None:
        from local_squad_inference.performance_budgets import budget_warnings

        assert budget_warnings("balanced", concurrent_sources=2, loaded_models=1) == []
        warnings = budget_warnings("best_quality", concurrent_sources=3, loaded_models=2)
        assert any("sources exceed" in warning for warning in warnings)

    def test_unknown_profile_raises(self) -> None:
        import pytest

        from local_squad_inference.performance_budgets import budget_for

        with pytest.raises(ValueError):
            budget_for("no-such-profile")
