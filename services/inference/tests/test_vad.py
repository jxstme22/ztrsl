import pytest

from local_squad_inference.vad import (
    SAMPLE_RATE,
    EnergySpeechDetector,
    EnergyUtteranceManager,
    SileroSpeechDetector,
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


def test_provisional_utterance_tracks_active_speech() -> None:
    manager = EnergyUtteranceManager()
    assert manager.provisional_utterance() is None

    manager.feed(frames(300, 0.0))
    manager.feed(frames(600, 0.1))
    snapshot = manager.provisional_utterance()
    assert snapshot is not None
    assert snapshot.is_final is False
    assert snapshot.started_ns <= 300_000_000
    assert len(snapshot.pcm_f32) >= SAMPLE_RATE * 700 // 1_000

    # Non-destructive: the active buffer keeps growing after the snapshot.
    manager.feed(frames(300, 0.1))
    later = manager.provisional_utterance()
    assert later is not None
    assert len(later.pcm_f32) > len(snapshot.pcm_f32)

    # The snapshot shares the utterance_id with the eventual final.
    utterances = manager.feed(frames(450, 0.0))
    utterances.extend(manager.flush())
    assert len(utterances) == 1
    assert utterances[0].utterance_id == snapshot.utterance_id
    assert utterances[0].is_final is True
    assert manager.provisional_utterance() is None


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


def test_energy_detector_rejects_non_finite_frames() -> None:
    detector = EnergySpeechDetector(threshold=0.018)

    assert detector.is_speech((float("nan"),) * 512) is False
    assert detector.is_speech((float("inf"),) * 512) is False
    assert detector.is_speech((0.1,) * 512) is True


def test_silero_detector_recovers_from_poisoned_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """A NaN hidden/cell state would permanently silence the VAD; the
    detector must reset instead so the next frame can recover."""
    import numpy
    import onnxruntime

    class FakeSession:
        def __init__(self, _path: str, **_: object) -> None:
            self.calls = 0

        def run(
            self,
            _output_names: object,
            _inputs: dict[str, object],
        ) -> tuple[object, object, object]:
            self.calls += 1
            if self.calls == 1:
                probabilities = numpy.array([[float("nan")]], dtype=numpy.float32)
            else:
                probabilities = numpy.array([[0.99]], dtype=numpy.float32)
            hidden = numpy.zeros((1, 1, 128), dtype=numpy.float32)
            cell = numpy.zeros((1, 1, 128), dtype=numpy.float32)
            return probabilities, hidden, cell

    monkeypatch.setattr(onnxruntime, "InferenceSession", FakeSession)
    detector = SileroSpeechDetector(threshold=0.5)

    assert detector.is_speech((0.1,) * 512) is False
    assert detector.is_speech((0.1,) * 512) is True
    assert not bool(detector._hidden.any())
    assert not bool(detector._cell.any())


def test_silero_detector_rejects_non_finite_samples(monkeypatch: pytest.MonkeyPatch) -> None:
    import onnxruntime

    class NeverCalled:
        def __init__(self, _path: str, **_: object) -> None:
            pass

        def run(self, _output_names: object, _inputs: dict[str, object]) -> object:
            raise AssertionError("session must not run on non-finite samples")

    monkeypatch.setattr(onnxruntime, "InferenceSession", NeverCalled)
    detector = SileroSpeechDetector(threshold=0.5)

    assert detector.is_speech((float("nan"),) * 512) is False
