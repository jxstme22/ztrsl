from collections.abc import Iterable
from pathlib import Path

from local_squad_inference.clip import process_clip
from local_squad_inference.media import MediaMetadata
from local_squad_inference.providers import FileAsrSegment
from local_squad_inference.vad import SAMPLE_RATE


class FakeDecoder:
    def inspect(self, source: Path) -> MediaMetadata:
        return MediaMetadata(source.name, 1.2, 42, True)

    def chunks(self, _source: Path) -> Iterable[tuple[float, ...]]:
        yield (0.0,) * (SAMPLE_RATE * 200 // 1_000)
        yield (0.1,) * (SAMPLE_RATE * 300 // 1_000)
        yield (0.0,) * (SAMPLE_RATE * 500 // 1_000)


class FakeFileAsr:
    def transcribe_file(self, _source: Path, _source_mode: str) -> tuple[FileAsrSegment, ...]:
        return (
            FileAsrSegment(
                start_ms=750,
                end_ms=2_100,
                text="Hindi ako nakatingin sa name.",
                inference_ms=12.0,
                model_id="contextual-test-asr",
                confidence=0.8,
            ),
        )


def test_clip_pipeline_segments_without_persisting_audio(tmp_path: Path) -> None:
    source = tmp_path / "friends.mp4"
    result = process_clip(source, "cebuano", decoder=FakeDecoder())

    assert result.metadata.display_name == "friends.mp4"
    assert result.mode == "demo"
    assert len(result.captions) == 1
    assert result.captions[0].source_mode == "cebuano"
    assert "demo transcript" in result.captions[0].source_text
    assert list(tmp_path.iterdir()) == []


def test_clip_pipeline_rejects_unknown_source_mode(tmp_path: Path) -> None:
    try:
        process_clip(tmp_path / "friends.mp4", "klingon", decoder=FakeDecoder())
    except ValueError as error:
        assert "source mode" in str(error)
    else:
        raise AssertionError("unsupported source mode should fail")


def test_contextual_file_asr_preserves_provider_timestamps(tmp_path: Path) -> None:
    source = tmp_path / "friends.mp4"
    result = process_clip(
        source,
        "mixed",
        decoder=FakeDecoder(),
        file_asr=FakeFileAsr(),
    )

    assert len(result.captions) == 1
    assert result.captions[0].start_ms == 750
    assert result.captions[0].end_ms == 2_100
    assert result.captions[0].source_text == "Hindi ako nakatingin sa name."
    assert result.captions[0].provider.startswith("contextual-test-asr+")
