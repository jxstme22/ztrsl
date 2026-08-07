from __future__ import annotations

from local_squad_inference.live import LivePipeline
from local_squad_inference.protocol import AudioPacket, AudioPacketV2
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


def test_live_pipeline_accepts_english_source_mode() -> None:
    pipeline = LivePipeline(
        FakeAsr("Push A site now"),
        FakeTranslation(),
        source_mode="english",
        vad_config=VadConfig(min_speech_ms=30, min_silence_ms=30),
        use_silero=False,
    )

    pipeline.feed(packet(1, (0.1,) * 960))
    captions = pipeline.feed(packet(2, (0.0,) * 960))

    assert len(captions) == 1
    assert captions[0].source_mode == "english"


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


# ---- Phase 5: per-source VAD state ---------------------------------------

TEAM_ID = "11111111111111111111111111111111"
DISCORD_ID = "22222222222222222222222222222222"

FAST_VAD = VadConfig(
    frame_ms=30,
    min_speech_ms=60,
    pre_roll_ms=60,
    min_silence_ms=90,
    max_utterance_ms=1_000,
)


def packet_v2(
    sequence: int,
    samples: tuple[float, ...],
    source_id: str,
) -> AudioPacketV2:
    return AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=sequence,
        capture_monotonic_ns=1_000_000_000 + sequence * 20_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        source_id=bytes.fromhex(source_id),
        samples=samples,
    )


def make_pipeline() -> LivePipeline:
    return LivePipeline(
        FakeAsr(),
        FakeTranslation(),
        vad_config=FAST_VAD,
        use_silero=False,
    )


def test_two_sources_keep_independent_utterance_state() -> None:
    pipeline = make_pipeline()
    pipeline.start_source(TEAM_ID)
    pipeline.start_source(DISCORD_ID)

    # Interleaved speech: both open utterances at the same time.
    assert pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID)) == ()
    assert pipeline.feed(packet_v2(2, (0.1,) * 4_800, DISCORD_ID)) == ()
    team = pipeline.feed(packet_v2(3, (0.0,) * 4_800, TEAM_ID))
    discord = pipeline.feed(packet_v2(4, (0.0,) * 4_800, DISCORD_ID))

    assert len(team) == 1 and len(discord) == 1
    assert team[0].status == "final"
    assert team[0].source_id == TEAM_ID
    assert discord[0].source_id == DISCORD_ID
    assert team[0].utterance_id != discord[0].utterance_id
    assert team[0].caption_id != discord[0].caption_id


def test_start_source_is_idempotent_and_presentation_edit_does_not_reset_vad() -> None:
    pipeline = make_pipeline()
    assert pipeline.start_source(TEAM_ID) is True
    assert pipeline.start_source(TEAM_ID) is False

    # An utterance is already open when the registry is re-pushed (what
    # happens on a mid-session rename). The VAD must keep the utterance.
    assert pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID)) == ()
    assert pipeline.start_source(TEAM_ID) is False
    captions = pipeline.feed(packet_v2(2, (0.0,) * 4_800, TEAM_ID))

    assert len(captions) == 1
    assert captions[0].utterance_id.endswith("-clip-utterance-1")
    assert captions[0].source_id == TEAM_ID


def test_stop_source_flushes_only_that_source() -> None:
    pipeline = make_pipeline()
    pipeline.start_source(TEAM_ID)
    pipeline.start_source(DISCORD_ID)
    assert pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID)) == ()
    assert pipeline.feed(packet_v2(2, (0.1,) * 4_800, DISCORD_ID)) == ()

    captions, metrics = pipeline.stop_source(TEAM_ID)
    assert len(captions) == 1
    assert captions[0].source_id == TEAM_ID
    assert metrics.packets_received == 1

    # TEAM state is gone: new packets raise until restarted.
    try:
        pipeline.feed(packet_v2(3, (0.0,) * 4_800, TEAM_ID))
    except ValueError as error:
        assert "unknown source" in str(error)
    else:
        raise AssertionError("stopped source must not accept packets")

    # DISCORD is untouched and still completes its utterance.
    discord = pipeline.feed(packet_v2(4, (0.0,) * 4_800, DISCORD_ID))
    assert len(discord) == 1
    assert discord[0].source_id == DISCORD_ID

    # A later packet restarts TEAM with fresh state (its own speech only).
    pipeline.start_source(TEAM_ID)
    assert pipeline.feed(packet_v2(5, (0.1,) * 4_800, TEAM_ID)) == ()
    restarted = pipeline.feed(packet_v2(6, (0.0,) * 4_800, TEAM_ID))
    assert len(restarted) == 1
    assert restarted[0].source_id == TEAM_ID
    # The restarted session began after DISCORD's final, so its first
    # utterance carries a higher capture timestamp than TEAM's old one.
    assert restarted[0].started_monotonic_ns > captions[0].started_monotonic_ns


def test_flush_source_keeps_vad_state_and_continues_sequence() -> None:
    pipeline = make_pipeline()
    pipeline.start_source(TEAM_ID)
    assert pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID)) == ()

    first = pipeline.flush_source(TEAM_ID)
    assert len(first) == 1
    assert first[0].utterance_id.endswith("-clip-utterance-1")

    # State is kept: the next utterance continues the same session.
    assert pipeline.feed(packet_v2(2, (0.1,) * 4_800, TEAM_ID)) == ()
    second = pipeline.feed(packet_v2(3, (0.0,) * 4_800, TEAM_ID))
    assert len(second) == 1
    assert second[0].utterance_id.endswith("-clip-utterance-2")
    assert second[0].source_id == TEAM_ID


def test_unknown_source_packets_raise_and_controls_are_noops() -> None:
    pipeline = make_pipeline()
    try:
        pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID))
    except ValueError as error:
        assert "unknown source" in str(error)
    else:
        raise AssertionError("unstarted source must be rejected")

    assert pipeline.stop_source(TEAM_ID) == ((), pipeline.metrics_for(TEAM_ID))
    assert pipeline.flush_source(TEAM_ID) == ()


def test_per_source_metrics_and_diagnostics() -> None:
    pipeline = make_pipeline()
    pipeline.start_source(TEAM_ID)
    pipeline.start_source(DISCORD_ID)
    pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID))
    pipeline.feed(packet_v2(2, (0.1,) * 4_800, TEAM_ID))
    pipeline.feed(packet_v2(3, (0.1,) * 4_800, DISCORD_ID))

    assert pipeline.metrics_for(TEAM_ID).packets_received == 2
    assert pipeline.metrics_for(DISCORD_ID).packets_received == 1
    assert pipeline.metrics.packets_received == 3
    assert pipeline.metrics_for("0" * 32).packets_received == 0

    team_diag = pipeline.diagnostics_for(TEAM_ID)
    assert team_diag["active"] is True
    assert team_diag["open_utterance_samples"] > 0
    assert team_diag["packets_received"] == 2
    assert pipeline.diagnostics_for("0" * 32)["active"] is False


# ---- v0.4 Phase 3/4: phrase filters + glossary wiring ------------------------


def test_phrase_filter_drops_utterance_before_translation() -> None:
    from local_squad_inference.phrase_filters import PhraseFilterRule, PhraseFilterSet

    filters = PhraseFilterSet(
        [
            PhraseFilterRule(
                source_id=TEAM_ID,
                text="user joined your channel",
                match_mode="contains",
            )
        ]
    )
    pipeline = make_pipeline()
    pipeline._asr = FakeAsr(text="user joined your channel")
    pipeline.start_source(TEAM_ID)
    pipeline.set_phrase_filters(filters)

    # A filtered utterance produces no caption and is counted.
    pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID))
    result = pipeline.feed(packet_v2(2, (0.0,) * 4_800, TEAM_ID))
    assert result == ()
    assert pipeline.diagnostics_for(TEAM_ID)["phrase_filtered"] == 1


def test_phrase_filter_is_per_source() -> None:
    from local_squad_inference.phrase_filters import PhraseFilterRule, PhraseFilterSet

    filters = PhraseFilterSet(
        [PhraseFilterRule(source_id=TEAM_ID, text="noise", match_mode="contains")]
    )
    pipeline = make_pipeline()
    pipeline.start_source(TEAM_ID)
    pipeline.start_source(DISCORD_ID)
    pipeline.set_phrase_filters(filters)

    # DISCORD's same text passes (rule is TEAM-scoped).
    pipeline.feed(packet_v2(1, (0.1,) * 4_800, DISCORD_ID))
    discord = pipeline.feed(packet_v2(2, (0.0,) * 4_800, DISCORD_ID))
    assert len(discord) == 1


def test_glossary_asr_correction_and_preferred_translation() -> None:
    from local_squad_inference.glossary import Glossary, GlossaryEntry

    glossary = Glossary(
        [
            GlossaryEntry(entry_type="asr_correction", source="bind men", target="B main"),
            GlossaryEntry(
                entry_type="preferred_translation",
                source="umiikot",
                target="rotating",
            ),
        ]
    )
    asr = FakeAsr(text="push bind men")
    pipeline = LivePipeline(asr, FakeTranslation(), vad_config=FAST_VAD, use_silero=False)
    pipeline.start_source(TEAM_ID)
    pipeline.set_glossary(glossary)

    pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID))
    result = pipeline.feed(packet_v2(2, (0.0,) * 4_800, TEAM_ID))
    assert len(result) == 1
    # ASR correction applied to the source text before translation.
    assert result[0].source_text == "push B main"


def test_glossary_hot_reload_swaps_corrections() -> None:
    from local_squad_inference.glossary import Glossary, GlossaryEntry

    pipeline = make_pipeline()
    pipeline._asr = FakeAsr(text="go bind")
    pipeline.start_source(TEAM_ID)
    pipeline.set_glossary(
        Glossary([GlossaryEntry(entry_type="asr_correction", source="bind", target="B main")])
    )
    pipeline.feed(packet_v2(1, (0.1,) * 4_800, TEAM_ID))
    first = pipeline.feed(packet_v2(2, (0.0,) * 4_800, TEAM_ID))
    assert first[0].source_text == "go B main"

    # Swap the glossary at runtime; the next utterance uses the new rules
    # without any pipeline/model restart.
    pipeline.set_glossary(Glossary())
    pipeline.feed(packet_v2(3, (0.1,) * 4_800, TEAM_ID))
    second = pipeline.feed(packet_v2(4, (0.0,) * 4_800, TEAM_ID))
    assert second[0].source_text == "go bind"


def test_pipeline_populates_audio_health_metrics_per_source() -> None:
    """DS-300: health metrics update during a live source and surface
    through diagnostics (deterministic states + recommendations)."""
    from local_squad_inference.audio_health import (
        policy_for_origin,
    )

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
    source_id = "0123456789abcdef0123456789abcdef"
    packet_v2 = AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=1,
        capture_monotonic_ns=1_000_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        samples=(0.2,) * 4_800,
        source_id=bytes.fromhex(source_id),
    )
    pipeline.start_source(
        source_id,
        source_mode="english",
        processing=policy_for_origin("physical_microphone"),
    )
    assert pipeline.feed(packet_v2) == ()
    diagnostics = pipeline.diagnostics_for(source_id)
    assert diagnostics["active"] is True
    assert diagnostics["health"]["packets_received"] == 1
    assert diagnostics["health"]["peak"] > 0.1
    assert diagnostics["health_state"]["state"] in {"ready", "very_quiet", "silent"}
    assert isinstance(diagnostics["recommendations"], list)


def test_pipeline_applies_normalization_policy_for_microphones() -> None:
    """DS-302/303: a physical-microphone source with a quiet signal gets
    bounded gain applied by the feed path."""
    from local_squad_inference.audio_health import (
        SourceProcessingPolicy,
        resolve_processing_policy,
    )

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
    source_id = "22222222222222222222222222222222"
    policy = resolve_processing_policy(
        "physical_microphone",
        overrides=None,
    )
    assert policy.normalize is True
    pipeline.start_source(
        source_id,
        source_mode="english",
        processing=SourceProcessingPolicy(normalize=False),  # explicit off wins
    )
    packet_v2 = AudioPacketV2(
        session_id=b"0123456789abcdef",
        sequence=1,
        capture_monotonic_ns=1_000_000_000,
        sample_rate=16_000,
        channels=1,
        flags=0,
        samples=(0.001,) * 4_800,
        source_id=bytes.fromhex(source_id),
    )
    pipeline.feed(packet_v2)
    assert pipeline.diagnostics_for(source_id)["health"]["peak"] < 0.01
