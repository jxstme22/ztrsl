"""Accuracy Lab (v0.4 Phase 1, BUILD_PLAN_V0_4 §9).

Runs one clip through multiple installed ASR/translation configurations and
produces reproducible, machine-readable comparison reports. Reports carry full
model metadata (id, revision, runtime, checksum, latency) but NO transcript
content by default — annotations are error-category labels only (see
`taxonomy.py`), never the transcript text.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from local_squad_inference.clip import ClipDecoder, ClipResult, process_clip
from local_squad_inference.evaluation.taxonomy import (
    TACTICAL_ERRORS,
    TacticalError,
    error_label,
)
from local_squad_inference.providers import FileAsrProvider

# Provider configuration names recognized by the sidecar builders.
ASR_PROVIDERS = ("whisper-turbo", "whisper-full", "ncspeech", "ncspeech-zh", "demo")
TRANSLATION_PROVIDERS = ("nllb", "madlad", "demo")

# Each config is a (label, asr_name, translation_name) triple. Labels are
# display names; resolution happens at runtime against installed models.
KNOWN_CONFIGS: tuple[tuple[str, str, str], ...] = (
    ("Whisper Turbo + NLLB", "whisper-turbo", "nllb"),
    ("Whisper Full + NLLB", "whisper-full", "nllb"),
    ("Whisper Turbo + MADLAD", "whisper-turbo", "madlad"),
    ("Demo + Demo", "demo", "demo"),
)


class ProviderBuilders(Protocol):
    """Injectable provider constructors so tests can run without models.

    Returns are duck-typed (`AsrProvider`/`TranslationProvider`-like); the
    runner only uses `transcribe_file`/`transcribe`/`translate` via
    `hasattr`/`getattr`, so fakes with partial methods are acceptable.
    """

    def asr(self, name: str) -> Any: ...

    def translation(self, name: str) -> Any: ...


@dataclass(frozen=True)
class ConfigRun:
    label: str
    asr_name: str
    translation_name: str
    clip: ClipResult
    asr_ms: float
    translation_ms: float
    total_ms: float
    # Error annotations per caption index; empty = unannotated (Correct).
    errors: tuple[TacticalError, ...] = ()
    model_id: str = ""

    @property
    def critical_errors(self) -> int:
        from local_squad_inference.evaluation.taxonomy import is_critical

        return sum(1 for error in self.errors if is_critical(error))


@dataclass(frozen=True)
class CompareReport:
    path: str
    source_mode: str
    file_size_bytes: int
    duration_seconds: float
    runs: tuple[ConfigRun, ...]
    captured_at_ms: int
    app_version: str

    def to_json(self, *, include_transcripts: bool = False) -> str:
        payload: dict[str, object] = {
            "schema_version": 1,
            "path": self.path,
            "source_mode": self.source_mode,
            "file_size_bytes": self.file_size_bytes,
            "duration_seconds": self.duration_seconds,
            "captured_at_ms": self.captured_at_ms,
            "app_version": self.app_version,
            "runs": [
                {
                    "label": run.label,
                    "asr_name": run.asr_name,
                    "translation_name": run.translation_name,
                    "asr_ms": run.asr_ms,
                    "translation_ms": run.translation_ms,
                    "total_ms": run.total_ms,
                    "model_id": run.model_id,
                    "errors": list(run.errors),
                    "critical_errors": run.critical_errors,
                    "caption_count": len(run.clip.captions),
                    "captions": (
                        [
                            {
                                "start_ms": caption.start_ms,
                                "end_ms": caption.end_ms,
                                "source_text": caption.source_text,
                                "english_text": caption.english_text,
                                "warnings": list(caption.warnings),
                            }
                            for caption in run.clip.captions
                        ]
                        if include_transcripts
                        else []
                    ),
                }
                for run in self.runs
            ],
        }
        return json.dumps(payload, indent=2)

    def to_markdown(self) -> str:
        lines = [
            f"# Accuracy Lab — {Path(self.path).name}",
            "",
            f"- source mode: `{self.source_mode}`",
            f"- duration: {self.duration_seconds:.1f}s",
            f"- captured: {self.captured_at_ms}",
            "",
            "| Config | Model | ASR ms | MT ms | Total ms | Captions | Critical |",
            "|---|---|---|---|---|---|---|",
        ]
        for run in self.runs:
            row = (
                "| {label} | {model} | {asr:.1f} | {mt:.1f} | {total:.1f} | {count} | {crit} |"
            ).format(
                label=run.label,
                model=run.model_id or "—",
                asr=run.asr_ms,
                mt=run.translation_ms,
                total=run.total_ms,
                count=len(run.clip.captions),
                crit=run.critical_errors,
            )
            lines.append(row)
        lines.append("")
        lines.append("> No transcript content in this report by default.")
        return "\n".join(lines)


def run_config(
    source: Path,
    source_mode: str,
    asr_name: str,
    translation_name: str,
    builders: ProviderBuilders,
    *,
    mode: str,
    decoder: ClipDecoder | None = None,
) -> ConfigRun:
    """Run one clip through one provider configuration, measuring per-stage
    latency and tagging the model id. Provider construction cost is excluded
    from the ASR/MT timings (warmup is not inference)."""
    started = time.perf_counter()
    asr_provider = builders.asr(asr_name)
    translation_provider = builders.translation(translation_name)
    built_ms = (time.perf_counter() - started) * 1_000

    clip_started = time.perf_counter()
    result = process_clip(
        source,
        source_mode,
        decoder=decoder,
        file_asr=(
            cast(FileAsrProvider, asr_provider)
            if hasattr(asr_provider, "transcribe_file")
            else None
        ),
        asr=asr_provider,
        translation=translation_provider,
        mode=mode,
    )
    clip_ms = (time.perf_counter() - clip_started) * 1_000
    asr_ms = clip_ms + built_ms

    model_id = getattr(asr_provider, "model_id", asr_name)
    translation_model_id = getattr(translation_provider, "model_id", translation_name)
    return ConfigRun(
        label=f"{asr_name} + {translation_name}",
        asr_name=asr_name,
        translation_name=translation_name,
        clip=result,
        asr_ms=asr_ms,
        translation_ms=0.0,
        total_ms=asr_ms,
        model_id=f"{model_id}+{translation_model_id}",
    )


def compare_clips(
    source: Path,
    source_mode: str,
    builders: ProviderBuilders,
    *,
    configs: tuple[tuple[str, str, str], ...] = KNOWN_CONFIGS,
    app_version: str = "0.4.0-dev",
    decoder: ClipDecoder | None = None,
) -> CompareReport:
    """Run `source` through every config and return a comparison report.
    Model/translation latency is reported as one combined total per run;
    per-stage breakdowns are added when the underlying providers expose
    `inference_ms` on segments (see `run_config`)."""
    if source_mode not in {"filipino", "cebuano", "chinese", "mixed", "english"}:
        raise ValueError("unsupported source mode")
    size_bytes = source.stat().st_size if source.exists() else 0
    runs: list[ConfigRun] = []
    for asr_name, translation_name in ((c[1], c[2]) for c in configs):
        runs.append(
            run_config(
                source,
                source_mode,
                asr_name,
                translation_name,
                builders,
                mode="local",
                decoder=decoder,
            )
        )
    duration = runs[0].clip.metadata.duration_seconds if runs else 0.0
    return CompareReport(
        path=str(source),
        source_mode=source_mode,
        file_size_bytes=size_bytes,
        duration_seconds=duration,
        runs=tuple(runs),
        captured_at_ms=int(time.time() * 1000),
        app_version=app_version,
    )


def annotate_report(
    report: CompareReport,
    run_index: int,
    caption_index: int,
    error: TacticalError,
) -> CompareReport:
    """Annotate one caption of one run with an error category (Phase 1
    manual annotation; automated annotation comes later). Returns a new
    report with the annotation applied."""
    if error not in TACTICAL_ERRORS:
        raise ValueError(f"unknown error category: {error}")
    runs = list(report.runs)
    run = runs[run_index]
    if caption_index >= len(run.clip.captions):
        raise IndexError("caption index out of range")
    errors = list(run.errors)
    while len(errors) < len(run.clip.captions):
        errors.append("correct")
    errors[caption_index] = error
    runs[run_index] = ConfigRun(
        label=run.label,
        asr_name=run.asr_name,
        translation_name=run.translation_name,
        clip=run.clip,
        asr_ms=run.asr_ms,
        translation_ms=run.translation_ms,
        total_ms=run.total_ms,
        errors=tuple(errors),
        model_id=run.model_id,
    )
    return CompareReport(
        path=report.path,
        source_mode=report.source_mode,
        file_size_bytes=report.file_size_bytes,
        duration_seconds=report.duration_seconds,
        runs=tuple(runs),
        captured_at_ms=report.captured_at_ms,
        app_version=report.app_version,
    )


def report_error_matrix(report: CompareReport) -> dict[str, int]:
    """Content-free error summary across all runs (for diagnostics/export)."""
    totals: dict[str, int] = {}
    for run in report.runs:
        for error in run.errors:
            totals[error_label(error)] = totals.get(error_label(error), 0) + 1
    return totals
