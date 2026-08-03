"""v0.4 Phase 4: glossary editor tests."""

import pytest

from local_squad_inference.glossary import Glossary, GlossaryEntry

TEAM = "11111111111111111111111111111111"


def test_asr_correction_applies() -> None:
    glossary = Glossary(
        [GlossaryEntry(entry_type="asr_correction", source="bind men", target="B main")]
    )
    result = glossary.apply("we push bind men", source_id=TEAM)
    assert result.applied
    assert result.corrected_text == "we push B main"


def test_alias_rewrites_in_order() -> None:
    glossary = Glossary(
        [
            GlossaryEntry(entry_type="alias", source="sova", target="Sova"),
            GlossaryEntry(entry_type="alias", source="sov", target="Sova"),
        ]
    )
    result = glossary.apply("sov recon bolt")
    assert result.corrected_text == "Sova recon bolt"


def test_preserve_terms_are_reported() -> None:
    glossary = Glossary([GlossaryEntry(entry_type="preserve", source="Jett", target="Jett")])
    assert glossary.preserve_terms("Jett dash top") == ["Jett"]
    assert glossary.preserve_terms("KJ util") == []


def test_preferred_translation_wins() -> None:
    glossary = Glossary(
        [
            GlossaryEntry(
                entry_type="preferred_translation",
                source="umiikot",
                target="rotating",
            )
        ]
    )
    assert glossary.preferred_translation("umiikot na tayo", "spinning around") == "rotating"
    assert glossary.preferred_translation("kalaban", "enemy") == "enemy"


def test_scoping_global_applies_everywhere() -> None:
    glossary = Glossary(
        [GlossaryEntry(entry_type="asr_correction", source="bind", target="B main")]
    )
    assert glossary.apply("go bind", source_id=TEAM).applied
    assert glossary.apply("go bind", source_id=None).applied


def test_source_scoped_entry_only_applies_to_its_source() -> None:
    glossary = Glossary(
        [
            GlossaryEntry(
                entry_type="asr_correction",
                source="bind",
                target="B main",
                scope="source",
                scope_key=TEAM,
            )
        ]
    )
    assert glossary.apply("go bind", source_id=TEAM).applied
    assert not glossary.apply("go bind", source_id="9999").applied


def test_hot_reload_semantics_no_state() -> None:
    glossary = Glossary()
    assert len(glossary) == 0
    glossary.add(GlossaryEntry(entry_type="asr_correction", source="bind", target="B main"))
    assert glossary.apply("go bind").applied  # no model restart needed


def test_length_limits() -> None:
    glossary = Glossary()
    with pytest.raises(ValueError):
        glossary.add(GlossaryEntry(entry_type="alias", source="", target="x"))
    with pytest.raises(ValueError):
        glossary.add(GlossaryEntry(entry_type="alias", source="x", target=""))


def test_json_roundtrip() -> None:
    glossary = Glossary(
        [
            GlossaryEntry(entry_type="asr_correction", source="bind men", target="B main"),
            GlossaryEntry(
                entry_type="preserve",
                source="Jett",
                target="Jett",
                scope="source",
                scope_key=TEAM,
                note="agent name",
            ),
        ]
    )
    restored = Glossary.from_json(glossary.to_json())
    assert len(restored) == 2
    assert restored.apply("bind men", source_id=TEAM).corrected_text == "B main"
    assert restored.preserve_terms("Jett") == ["Jett"]
