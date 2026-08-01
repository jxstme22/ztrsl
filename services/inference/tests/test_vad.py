import pytest

from local_squad_inference.vad import (
    SAMPLE_RATE,
    EnergyUtteranceManager,
    VadConfig,
    vad_config_from_sensitivity,
)


def frames(milliseconds: int, amplitude: float) -> tuple[float, ...]:
    return (amplitude,) * (SAMPLE_RATE * milliseconds // 1_000)


def test_silence_does_not_create_utterance() -> None:
    manager = EnergyUtteranceManager()

    assert manager.feed(frames(1_000, 0.0)) == []
    assert manager.flush() == []


def test_pre_roll_and_hangover_are_retained() -> None:
    manager = EnergyUtteranceManager()
    manager.feed(frames(300, 0.0))
    manager.feed(frames(300, 0.1))
    utterances = manager.feed(frames(450, 0.0))

    assert len(utterances) == 1
    utterance = utterances[0]
    assert utterance.started_ns <= 300_000_000
    assert len(utterance.pcm_f32) >= SAMPLE_RATE * 900 // 1_000
    assert utterance.forced_end is False


def test_long_speech_forces_bounded_split_with_overlap() -> None:
    config = VadConfig(
        min_speech_ms=60,
        pre_roll_ms=60,
        max_utterance_ms=300,
        min_silence_ms=90,
    )
    manager = EnergyUtteranceManager(config)

    utterances = manager.feed(frames(720, 0.1))
    utterances.extend(manager.flush())

    assert len(utterances) >= 2
    assert utterances[0].forced_end is True
    assert all(len(item.pcm_f32) <= SAMPLE_RATE * 300 // 1_000 for item in utterances)
    assert utterances[1].started_ns < utterances[0].ended_ns


def test_sensitivity_50_matches_baseline_vad_config() -> None:
    baseline = VadConfig()
    mapped = vad_config_from_sensitivity(50)

    assert mapped.silero_threshold == baseline.silero_threshold
    assert mapped.speech_rms == pytest.approx(baseline.speech_rms, abs=0.001)
    assert mapped.min_silence_ms == pytest.approx(baseline.min_silence_ms, abs=50)


def test_higher_sensitivity_lowers_gates_and_silence() -> None:
    sensitive = vad_config_from_sensitivity(100)
    strict = vad_config_from_sensitivity(0)

    assert sensitive.silero_threshold < strict.silero_threshold
    assert sensitive.speech_rms < strict.speech_rms
    assert sensitive.min_silence_ms < strict.min_silence_ms


def test_sensitivity_clamps_out_of_range() -> None:
    assert vad_config_from_sensitivity(1000).silero_threshold == vad_config_from_sensitivity(
        100
    ).silero_threshold
    assert vad_config_from_sensitivity(-20).min_silence_ms == vad_config_from_sensitivity(
        0
    ).min_silence_ms
