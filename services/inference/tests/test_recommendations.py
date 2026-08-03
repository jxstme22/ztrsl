"""v0.4 Phase 8: model recommendation tests."""

from local_squad_inference.evaluation.recommendations import hardware_class, recommend


def test_hardware_class() -> None:
    assert hardware_class(None, True) == "cpu"
    assert hardware_class(4.0, True) == "gpu-low"
    assert hardware_class(8.0, True) == "gpu-medium"
    assert hardware_class(16.0, True) == "gpu-high"
    assert hardware_class(16.0, False) == "cpu"


def test_strict_tagalog_suggests_fixed_ctc() -> None:
    rec = recommend(profile_id="tagalog", strictness="strict", hardware="cpu")
    assert rec.asr_provider == "ncspeech"
    assert rec.differs_from_default
    assert any("fixed-language" in line for line in rec.rationale)


def test_mandarin_suggests_citrinet() -> None:
    rec = recommend(profile_id="mandarin", strictness="balanced", hardware="gpu-medium")
    assert rec.asr_provider == "ncspeech-zh"


def test_balanced_tagalog_defaults_to_whisper_nllb() -> None:
    rec = recommend(profile_id="tagalog", strictness="balanced", hardware="cpu")
    assert rec.asr_provider == "whisper-large-v3-turbo"
    assert rec.translation_provider == "nllb"
    assert not rec.differs_from_default


def test_maximum_accuracy_on_gpu_suggests_madlad() -> None:
    rec = recommend(
        profile_id="tagalog",
        strictness="balanced",
        hardware="gpu-high",
        resource_policy="maximum_accuracy",
    )
    assert rec.translation_provider == "madlad"
    assert rec.differs_from_default


def test_maximum_accuracy_on_cpu_stays_nllb() -> None:
    rec = recommend(
        profile_id="tagalog",
        strictness="balanced",
        hardware="cpu",
        resource_policy="maximum_accuracy",
    )
    assert rec.translation_provider == "nllb"


def test_accuracy_winner_is_credited() -> None:
    rec = recommend(
        profile_id="tagalog",
        strictness="balanced",
        hardware="gpu-medium",
        accuracy_winner_asr="whisper-large-v3",
    )
    assert rec.asr_provider == "whisper-large-v3"
    assert any("Accuracy Lab" in line for line in rec.rationale)
    assert rec.differs_from_default


def test_uninstalled_recommendation_is_honest() -> None:
    rec = recommend(
        profile_id="tagalog",
        strictness="strict",
        hardware="cpu",
        installed_asr=set(),
        installed_translation=set(),
    )
    assert any("not installed" in line for line in rec.rationale)
