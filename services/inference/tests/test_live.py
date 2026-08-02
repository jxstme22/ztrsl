from __future__ import annotations

from local_squad_inference.live import LivePipeline
from local_squad_inference.protocol import AudioPacket
from local_squad_inference.providers import AsrResult, TranslationResult
from local_squad_inference.vad import AudioUtterance, VadConfig


class FakeAsr:
    model_id = "fake-large-v3"

    def __init__(self, text: str = "Hindi ako nakatingin sa name.") -> None:
        self.text = text

    def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
        utterance_id = utterance.utterance_id
        return AsrResult(
            utterance_id=utterance_id,
            text=self.text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=42.0,
            model_id=self.model_id,
            confidence=0.82,
        )


class FakeTranslation:
    def translate(self, result: AsrResult) -> TranslationResult:
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text="I wasn't looking at the name.",
            is_final=True,
            inference_ms=18.0,
            model_id="fake-mt",
        )


def packet(sequence: int, samples: tuple[float, ...]) -> AudioPacket:
    return AudioPacket(
        session_id=b"0123456789abcdef",
        sequence=sequence,
        capture_monotonic_ns=1_000_000_000 + sequence * 20_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        samples=samples,
    )


def test_live_pipeline_emits_final_tagalog_caption_after_conversation_pause() -> None:
    pipeline = LivePipeline(
        FakeAsr(),
        FakeTranslation(),
        vad_config=VadConfig(
            frame_ms=30,
            min_speech_ms=60,
            pre_roll_ms=60,
            min_silence_ms=90,
            max_utterance_ms=1_000,
        ),
        use_silero=False,
    )

    assert pipeline.feed(packet(1, (0.1,) * 4_800)) == ()
    captions = pipeline.feed(packet(2, (0.0,) * 4_800))

    assert len(captions) == 1
    assert captions[0].status == "final"
    assert captions[0].source_mode == "filipino"
    assert captions[0].source_text == "Hindi ako nakatingin sa name."
    assert captions[0].english_text == "I wasn't looking at the name."
    assert captions[0].asr_ms == 42.0
    assert pipeline.metrics.captions_emitted == 1


def test_live_pipeline_marks_unexpected_script_as_low_confidence() -> None:
    pipeline = LivePipeline(
        FakeAsr("مرحبا"),
        FakeTranslation(),
        vad_config=VadConfig(min_speech_ms=30, min_silence_ms=30),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 960))
    captions = pipeline.feed(packet(2, (0.0,) * 960))

    assert captions
    assert "LOW_CONFIDENCE" in captions[0].warnings


def test_live_pipeline_surfaces_asr_failure_as_visible_caption() -> None:
    class FailingAsr:
        model_id = "groq-whisper"

        def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
            return AsrResult(
                utterance_id=utterance.utterance_id,
                text="",
                source_mode=source_mode,
                is_final=True,
                inference_ms=0.0,
                model_id=self.model_id,
                confidence=None,
                error="HTTP 401: bad API key",
            )

    pipeline = LivePipeline(
        FailingAsr(),
        FakeTranslation(),
        vad_config=VadConfig(min_speech_ms=30, min_silence_ms=30),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 960))
    captions = pipeline.feed(packet(2, (0.0,) * 960))

    assert len(captions) == 1
    assert captions[0].status == "final"
    assert captions[0].source_text == "[Speech recognition unavailable]"
    assert "HTTP 401" in captions[0].english_text
    assert "LOW_CONFIDENCE" in captions[0].warnings
    assert pipeline.metrics.captions_emitted == 1


def test_live_pipeline_skips_silent_empty_transcript_without_error() -> None:
    class EmptyAsr:
        model_id = "fake-asr"

        def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
            return AsrResult(
                utterance_id=utterance.utterance_id,
                text="",
                source_mode=source_mode,
                is_final=True,
                inference_ms=0.0,
                model_id=self.model_id,
                confidence=None,
            )

    pipeline = LivePipeline(
        EmptyAsr(),
        FakeTranslation(),
        vad_config=VadConfig(min_speech_ms=30, min_silence_ms=30),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 960))
    captions = pipeline.feed(packet(2, (0.0,) * 960))

    assert captions == ()
    assert pipeline.metrics.captions_emitted == 0


def test_live_pipeline_emits_provisional_then_final_with_increasing_revisions() -> None:
    pipeline = LivePipeline(
        FakeAsr(),
        FakeTranslation(),
        vad_config=VadConfig(
            frame_ms=30,
            min_speech_ms=60,
            pre_roll_ms=60,
            min_silence_ms=90,
            max_utterance_ms=1_000,
        ),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 4_800))
    snapshot = pipeline.provisional_utterance()
    assert snapshot is not None
    assert snapshot.is_final is False

    provisionals = pipeline.infer_utterances([snapshot])
    assert len(provisionals) == 1
    first = provisionals[0]
    assert first.status == "provisional"
    assert first.revision == 1
    assert first.ended_monotonic_ns is None
    assert pipeline.metrics.captions_emitted == 0

    later = pipeline.provisional_utterance()
    assert later is not None
    second = pipeline.infer_utterances([later])[0]
    assert second.status == "provisional"
    assert second.revision == 2
    assert second.utterance_id == first.utterance_id

    finals = pipeline.feed(packet(2, (0.0,) * 4_800))
    assert len(finals) == 1
    final = finals[0]
    assert final.status == "final"
    assert final.utterance_id == first.utterance_id
    # The final always outranks the last provisional so the UI replaces it.
    assert final.revision > second.revision
    assert final.ended_monotonic_ns is not None
    assert pipeline.metrics.captions_emitted == 1
    assert pipeline.metrics.utterances_completed == 1
    assert pipeline.provisional_utterance() is None


def test_live_pipeline_drops_silent_provisional_without_emitting_failure() -> None:
    class EmptyAsr:
        model_id = "fake-asr"

        def transcribe(self, utterance: AudioUtterance, source_mode: str) -> AsrResult:
            return AsrResult(
                utterance_id=utterance.utterance_id,
                text="",
                source_mode=source_mode,
                is_final=False,
                inference_ms=0.0,
                model_id=self.model_id,
                confidence=None,
            )

    pipeline = LivePipeline(
        EmptyAsr(),
        FakeTranslation(),
        vad_config=VadConfig(
            frame_ms=30,
            min_speech_ms=60,
            pre_roll_ms=60,
            min_silence_ms=90,
            max_utterance_ms=1_000,
        ),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 4_800))
    snapshot = pipeline.provisional_utterance()
    assert snapshot is not None
    assert pipeline.infer_utterances([snapshot]) == ()

    finals = pipeline.feed(packet(2, (0.0,) * 4_800))
    assert finals == ()
    assert pipeline.metrics.captions_emitted == 0
    assert pipeline.metrics.utterances_completed == 1


def test_live_pipeline_rejects_wrong_audio_format() -> None:
    pipeline = LivePipeline(FakeAsr(), FakeTranslation(), use_silero=False)
    invalid = packet(1, (0.0,) * 320).model_copy(update={"sample_rate": 48_000})

    try:
        pipeline.feed(invalid)
    except ValueError as error:
        assert "16 kHz mono" in str(error)
    else:
        raise AssertionError("invalid live audio format should fail")
