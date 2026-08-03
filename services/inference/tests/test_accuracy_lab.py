"""v0.4 Phase 1: Accuracy Lab comparison + report tests (no models)."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from local_squad_inference.evaluation.accuracy_lab import (
    annotate_report,
    compare_clips,
    report_error_matrix,
)
from local_squad_inference.media import MediaMetadata
from local_squad_inference.providers import AsrResult, TranslationResult


class FakeDecoder:
    def inspect(self, source: Path) -> MediaMetadata:
        return MediaMetadata(
            display_name=source.name,
            duration_seconds=3.0,
            size_bytes=source.stat().st_size,
            has_audio=True,
        )

    def chunks(self, source: Path) -> Iterator[tuple[float, ...]]:
        yield (0.1,) * 800
        yield (0.0,) * 800


class FakeAsr:
    model_id = "fake-asr"

    def transcribe_file(self, source: Path, source_mode: str) -> list[object]:
        return [
            type(
                "Seg",
                (),
                {
                    "start_ms": 0,
                    "end_ms": 2000,
                    "text": "kumusta",
                    "inference_ms": 10.0,
                    "model_id": "fake-asr",
                    "confidence": 0.9,
                },
            )()
        ]


class FakeTranslation:
    model_id = "fake-mt"

    def translate(self, result: AsrResult) -> TranslationResult:
        return TranslationResult(
            utterance_id=result.utterance_id,
            source_text=result.text,
            english_text="hello",
            is_final=True,
            inference_ms=5.0,
            model_id="fake-mt",
        )


class FakeBuilders:
    def asr(self, name: str) -> FakeAsr:
        return FakeAsr()

    def translation(self, name: str) -> FakeTranslation:
        return FakeTranslation()


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"fake-media")
    return source


def test_compare_clips_runs_all_configs(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    assert len(report.runs) == 4
    for run in report.runs:
        assert run.model_id.startswith("fake-asr+")
        assert len(run.clip.captions) >= 1
    assert report.file_size_bytes > 0


def test_report_json_is_content_free_by_default(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    serialized = report.to_json()
    assert "captions" in serialized
    assert '"source_text"' not in serialized
    assert '"english_text"' not in serialized
    assert "kumusta" not in serialized


def test_report_json_can_include_transcripts_for_offline_review(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    serialized = report.to_json(include_transcripts=True)
    assert "source_text" in serialized
    assert "kumusta" in serialized


def test_report_markdown_is_content_free(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    markdown = report.to_markdown()
    assert "Accuracy Lab" in markdown
    assert "kumusta" not in markdown
    assert "| Config | Model | ASR ms |" in markdown


def test_annotate_report_and_error_matrix(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    annotated = annotate_report(report, run_index=0, caption_index=0, error="wrong_number")
    assert annotated.runs[0].errors[0] == "wrong_number"
    matrix = report_error_matrix(annotated)
    assert matrix.get("Wrong number") == 1
    assert sum(matrix.values()) >= 1


def test_annotate_rejects_unknown_category(clip: Path) -> None:
    report = compare_clips(clip, "filipino", FakeBuilders(), decoder=FakeDecoder())
    with pytest.raises(ValueError):
        annotate_report(report, 0, 0, "bogus")  # type: ignore[arg-type]


def test_compare_rejects_unknown_source_mode(clip: Path) -> None:
    with pytest.raises(ValueError):
        compare_clips(clip, "klingon", FakeBuilders())
