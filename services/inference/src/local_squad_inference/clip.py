from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from local_squad_inference.media import FfmpegDecoder, MediaMetadata
from local_squad_inference.providers import (
    AsrProvider,
    AsrResult,
    DemoAsrProvider,
    DemoTranslationProvider,
    FileAsrProvider,
    TranslationProvider,
)
from local_squad_inference.vad import AudioUtterance, EnergyUtteranceManager

MAX_CLIP_SEGMENTS = 128


class ClipDecoder(Protocol):
    def inspect(self, source: Path) -> MediaMetadata: ...

    def chunks(self, source: Path) -> Iterable[tuple[float, ...]]: ...


@dataclass(frozen=True)
class ClipCaption:
    utterance_id: str
    start_ms: int
    end_ms: int
    source_mode: str
    source_text: str
    english_text: str
    forced_split: bool
    provider: str
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ClipResult:
    metadata: MediaMetadata
    captions: tuple[ClipCaption, ...]
    truncated: bool
    mode: str


def process_clip(
    source: Path,
    source_mode: str,
    *,
    decoder: ClipDecoder | None = None,
    asr: AsrProvider | None = None,
    file_asr: FileAsrProvider | None = None,
    translation: TranslationProvider | None = None,
    mode: str = "demo",
) -> ClipResult:
    if source_mode not in {"filipino", "cebuano", "chinese", "mixed", "english"}:
        raise ValueError("unsupported source mode")
    media = decoder or FfmpegDecoder()
    metadata = media.inspect(source)
    translation_provider = translation or DemoTranslationProvider()
    if file_asr is not None:
        return _process_contextual_file(
            source,
            source_mode,
            metadata,
            file_asr,
            translation_provider,
            mode,
        )
    manager = EnergyUtteranceManager()
    asr_provider = asr or DemoAsrProvider()
    captions: list[ClipCaption] = []
    truncated = False

    for chunk in media.chunks(source):
        for utterance in manager.feed(chunk):
            _append_caption(captions, utterance, source_mode, asr_provider, translation_provider)
            if len(captions) >= MAX_CLIP_SEGMENTS:
                truncated = True
                break
        if truncated:
            break
    if not truncated:
        for utterance in manager.flush():
            _append_caption(captions, utterance, source_mode, asr_provider, translation_provider)
    return ClipResult(metadata, tuple(captions), truncated, mode)


def _process_contextual_file(
    source: Path,
    source_mode: str,
    metadata: MediaMetadata,
    asr_provider: FileAsrProvider,
    translation_provider: TranslationProvider,
    mode: str,
) -> ClipResult:
    captions: list[ClipCaption] = []
    segments = asr_provider.transcribe_file(source, source_mode)
    truncated = len(segments) > MAX_CLIP_SEGMENTS
    for index, segment in enumerate(segments[:MAX_CLIP_SEGMENTS]):
        utterance_id = f"clip-{index + 1}"
        transcript = AsrResult(
            utterance_id=utterance_id,
            text=segment.text,
            source_mode=source_mode,
            is_final=True,
            inference_ms=segment.inference_ms,
            model_id=segment.model_id,
            confidence=segment.confidence,
        )
        translated = translation_provider.translate(transcript)
        english_text = translated.english_text
        warnings: list[str] = []
        if not english_text.strip():
            english_text = "[No reliable English translation]"
            warnings.append("LOW_CONFIDENCE")
        if segment.confidence is not None and segment.confidence < 0.35:
            warnings.append("LOW_CONFIDENCE")
        captions.append(
            ClipCaption(
                utterance_id=utterance_id,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                source_mode=source_mode,
                source_text=segment.text,
                english_text=english_text,
                forced_split=False,
                provider=f"{segment.model_id}+{translated.model_id}",
                warnings=tuple(dict.fromkeys(warnings)),
            )
        )
    return ClipResult(metadata, tuple(captions), truncated, mode)


def _append_caption(
    captions: list[ClipCaption],
    utterance: AudioUtterance,
    source_mode: str,
    asr_provider: AsrProvider,
    translation_provider: TranslationProvider,
) -> None:
    transcript = asr_provider.transcribe(utterance, source_mode)
    if not transcript.text.strip():
        return
    warnings: list[str] = []
    try:
        translated = translation_provider.translate(transcript)
        english_text = translated.english_text
        provider_tag = translated.model_id
        if not english_text.strip():
            english_text = "[No reliable English translation]"
            warnings.append("LOW_CONFIDENCE")
    except Exception:
        english_text = "[Translation unavailable]"
        warnings.append("LOW_CONFIDENCE")
        provider_tag = "unavailable"
    if utterance.forced_end:
        warnings.append("FORCED_SPLIT")
    captions.append(
        ClipCaption(
            utterance_id=utterance.utterance_id,
            start_ms=utterance.started_ns // 1_000_000,
            end_ms=utterance.ended_ns // 1_000_000,
            source_mode=source_mode,
            source_text=transcript.text,
            english_text=english_text,
            forced_split=utterance.forced_end,
            provider=f"{transcript.model_id}+{provider_tag}",
            warnings=tuple(warnings),
        )
    )
