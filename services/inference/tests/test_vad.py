from local_squad_inference.vad import SAMPLE_RATE, EnergyUtteranceManager, VadConfig


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

