from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from local_squad_inference.media import FfmpegDecoder, MediaMetadata
from local_squad_inference.providers import (
    AsrProvider,
    DemoAsrProvider,
    DemoTranslationProvider,
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
    translation: TranslationProvider | None = None,
    mode: str = "demo",
) -> ClipResult:
    if source_mode not in {"filipino", "cebuano", "mixed"}:
        raise ValueError("unsupported source mode")
    media = decoder or FfmpegDecoder()
    metadata = media.inspect(source)
    manager = EnergyUtteranceManager()
    asr_provider = asr or DemoAsrProvider()
    translation_provider = translation or DemoTranslationProvider()
    captions: list[ClipCaption] = []
    truncated = False

    for chunk in media.chunks(source):
        for utterance in manager.feed(chunk):
            _append_caption(
                captions, utterance, source_mode, asr_provider, translation_provider
            )
            if len(captions) >= MAX_CLIP_SEGMENTS:
                truncated = True
                break
        if truncated:
            break
    if not truncated:
        for utterance in manager.flush():
            _append_caption(
                captions, utterance, source_mode, asr_provider, translation_provider
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
    translated = translation_provider.translate(transcript)
    captions.append(
        ClipCaption(
            utterance_id=utterance.utterance_id,
            start_ms=utterance.started_ns // 1_000_000,
            end_ms=utterance.ended_ns // 1_000_000,
            source_mode=source_mode,
            source_text=transcript.text,
            english_text=translated.english_text,
            forced_split=utterance.forced_end,
            provider=f"{transcript.model_id}+{translated.model_id}",
        )
    )
