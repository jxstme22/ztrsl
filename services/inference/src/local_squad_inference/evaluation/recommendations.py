"""Model recommendations (v0.4 Phase 8, BUILD_PLAN_V0_4 §10).

Suggestions are OPTIONAL and EXPLAINABLE: they combine the source language
profile, strictness, hardware class, installed runtimes, resource policy, and
(optionally) Accuracy Lab results. They never install or switch models
automatically — the user always decides.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

HardwareClass = Literal["cpu", "gpu-low", "gpu-medium", "gpu-high"]
ResourcePolicy = Literal["maximum_accuracy", "balanced", "protect_game_performance"]

# Whisper model id -> display name + whether it is the recommended default.
ASR_OPTIONS: dict[str, str] = {
    "whisper-large-v3-turbo": "Whisper Turbo",
    "whisper-large-v3": "Whisper Full",
    "ncspeech": "NCSpeech Tagalog (CTC)",
    "ncspeech-zh": "Citrinet Mandarin (CTC)",
}
TRANSLATION_OPTIONS: dict[str, str] = {
    "nllb": "NLLB",
    "madlad": "MADLAD",
}


@dataclass(frozen=True)
class Recommendation:
    asr_provider: str
    translation_provider: str
    rationale: tuple[str, ...]
    # True when a non-default choice is being suggested (differs from the
    # common balanced/default pair).
    differs_from_default: bool


def hardware_class(gpu_vram_gb: float | None, has_gpu: bool) -> HardwareClass:
    """Classify the machine from GPU info. None/CPU -> cpu."""
    if not has_gpu or gpu_vram_gb is None:
        return "cpu"
    if gpu_vram_gb < 6:
        return "gpu-low"
    if gpu_vram_gb < 12:
        return "gpu-medium"
    return "gpu-high"


def recommend(
    *,
    profile_id: str,
    strictness: str,
    hardware: HardwareClass,
    resource_policy: ResourcePolicy = "balanced",
    installed_asr: frozenset[str] = frozenset(),
    installed_translation: frozenset[str] = frozenset(),
    accuracy_winner_asr: str | None = None,
) -> Recommendation:
    """Pick an ASR/MT pair and explain why. Installed-run-time awareness only
    changes the explanation, never installs or switches anything."""
    rationale: list[str] = []
    differs = False

    # ASR: fixed-language CTC models suit a forced/strict profile on the
    # right language; multilingual Whisper fits everything else.
    if profile_id in {"tagalog", "cebuano", "taglish", "bislish"} and strictness == "strict":
        asr = "ncspeech"
        rationale.append(
            "Strict Tagalog-family profile: the fixed-language CTC model cannot drift "
            "to another language."
        )
        differs = True
    elif profile_id in {"mandarin", "chinese_english"}:
        asr = "ncspeech-zh"
        rationale.append("Mandarin profile: fixed-language Mandarin CTC decoder.")
        differs = True
    else:
        asr = (
            accuracy_winner_asr if accuracy_winner_asr in ASR_OPTIONS else "whisper-large-v3-turbo"
        )
        if accuracy_winner_asr in ASR_OPTIONS and accuracy_winner_asr != "whisper-large-v3-turbo":
            rationale.append(
                f"Accuracy Lab ranked {ASR_OPTIONS[accuracy_winner_asr]} best on this clip."
            )
            differs = True
        else:
            rationale.append("Whisper Turbo: best latency/accuracy balance for multilingual play.")

    # MT: MADLAD only under maximum_accuracy on a capable machine; NLLB otherwise.
    if resource_policy == "maximum_accuracy" and hardware in {"gpu-medium", "gpu-high"}:
        translation = "madlad"
        rationale.append(
            "Maximum-accuracy policy on capable hardware: MADLAD produces stronger "
            "translations at higher cost."
        )
        differs = True
    else:
        translation = "nllb"
        rationale.append("NLLB: near-real-time translation with a modest VRAM footprint.")

    # Honest caveats when the recommended runtime is not installed.
    if asr not in installed_asr and asr != "demo":
        rationale.append(f"{ASR_OPTIONS[asr]} is not installed — install it to use this.")
    if translation not in installed_translation and translation != "demo":
        rationale.append(
            f"{TRANSLATION_OPTIONS[translation]} is not installed — install it to use this."
        )

    return Recommendation(
        asr_provider=asr,
        translation_provider=translation,
        rationale=tuple(rationale),
        differs_from_default=differs,
    )
