"""DS-700/701/702: recognition plans, hardware snapshots, routing table.

The router returns a *plan*; it never loads models. Every route carries a
reason string, missing preferred models degrade to a documented fallback,
and no route silently forces an unrelated language.
"""

from __future__ import annotations

import os
import platform
import sys
from collections.abc import Callable
from dataclasses import dataclass

# --- DS-700: recognition request / plan types -------------------------------


@dataclass(frozen=True)
class RecognitionRequest:
    source_id: str | None
    language_config: dict[str, object]
    domain_preset_id: str
    quality_profile_id: str
    is_provisional: bool
    duration_ms: int
    hardware: HardwareCapabilities


@dataclass(frozen=True)
class RecognitionPlan:
    primary_provider_id: str
    fallback_provider_id: str | None
    language_hint: str | None
    allowed_languages: tuple[str, ...]
    contextual_prompt_id: str | None
    allow_fallback: bool
    reason: str


# --- DS-701: hardware capability snapshot -----------------------------------


@dataclass(frozen=True)
class HardwareCapabilities:
    operating_system: str
    architecture: str
    cuda_visible: bool
    usable_cuda_runtime: bool
    vram_class: str
    apple_silicon: bool
    cpu_thread_class: str
    installed_models: frozenset[str] = frozenset()


def snapshot_hardware(
    *,
    cuda_count: Callable[[], int] | None = None,
    installed_models: set[str] | frozenset[str] | None = None,
) -> HardwareCapabilities:
    """Capture OS/arch/CUDA/CPU class and installed models. `cuda_count` is
    injectable so tests can mock GPU visibility without a GPU. GPU visibility
    is distinguished from a usable runtime: a visible GPU still needs the
    runtime DLLs the app can download."""
    os_name = (
        "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"
    )
    arch = platform.machine().lower()
    apple_silicon = os_name == "macos" and arch in {"arm64", "aarch64"}
    cuda_visible = False
    if cuda_count is not None:
        try:
            cuda_visible = cuda_count() > 0
        except Exception:
            cuda_visible = False
    return HardwareCapabilities(
        operating_system=os_name,
        architecture=arch,
        cuda_visible=cuda_visible,
        usable_cuda_runtime=cuda_visible and os.environ.get("LST_CUDA_RUNTIME") != "missing",
        vram_class="high" if cuda_visible else "low",
        apple_silicon=apple_silicon,
        cpu_thread_class=("high" if (os.cpu_count() or 0) >= 8 else "standard"),
        installed_models=frozenset(installed_models or ()),
    )


# --- DS-702: deterministic routing table -------------------------------------

LANGUAGE_PROVIDER_MAP: dict[str, tuple[str, ...]] = {
    "zh": ("faster-whisper", "sensevoice", "paraformer", "ncspeech-zh"),
    "zh-en": ("sensevoice", "faster-whisper"),
    "tl": ("faster-whisper", "ncspeech"),
    "tl-en": ("faster-whisper",),
    "en": ("faster-whisper", "groq-whisper", "nvidia-whisper-large-v3"),
    "id": ("faster-whisper",),
    "vi": ("faster-whisper",),
    "th": ("faster-whisper",),
    "ms": ("faster-whisper",),
}

PROVIDER_MODELS: dict[str, str] = {
    "faster-whisper": "whisper-large-v3-turbo",
    "mlx-whisper": "mlx-whisper-large-v3-turbo-q4",
    "sensevoice": "sensevoice-small",
    "paraformer": "paraformer-zh-streaming",
    "ncspeech": "ncspeech-tl-fastconformer-hybrid-large",
    "ncspeech-zh": "ncspeech-zh-citrinet-1024-gamma",
    "groq-whisper": "groq-whisper",
    "nvidia-whisper-large-v3": "nvidia-whisper-large-v3",
}


def _language_key(language_config: dict[str, object]) -> str:
    primary = language_config.get("primary_language")
    if isinstance(primary, str) and primary:
        secondary = language_config.get("secondary_languages")
        if isinstance(secondary, list) and "en" in secondary:
            return f"{primary}-en"
        return primary
    return "auto"


def _provider_installed(provider_id: str, hardware: HardwareCapabilities) -> bool:
    model_id = PROVIDER_MODELS.get(provider_id)
    if model_id is None:
        return True  # cloud providers are always "installed"
    return model_id in hardware.installed_models


def route_recognition(
    request: RecognitionRequest,
) -> RecognitionPlan:
    """Deterministic routing: language intent first, then hardware, then
    quality. Missing preferred models degrade to the next documented
    provider; no route silently selects an unrelated language."""
    hardware = request.hardware
    quality = request.quality_profile_id
    language_key = _language_key(request.language_config)
    if language_key == "auto":
        language_hint: str | None = None
        allowed: tuple[str, ...] = ()
    else:
        language_hint = language_key.split("-")[0]
        allowed = tuple(language_key.split("-"))

    candidates = LANGUAGE_PROVIDER_MAP.get(language_key)
    if candidates is None and language_key != "auto":
        # Unsupported language: never fall back to an unrelated decoder.
        return RecognitionPlan(
            primary_provider_id="",
            fallback_provider_id=None,
            language_hint=None,
            allowed_languages=(),
            contextual_prompt_id=None,
            allow_fallback=False,
            reason=f"no provider supports language '{language_key}'",
        )

    # Auto: any installed multilingual provider, in a stable order.
    ordered = (
        list(candidates)
        if candidates is not None
        else [
            "faster-whisper",
            "mlx-whisper",
            "sensevoice",
            "groq-whisper",
            "nvidia-whisper-large-v3",
        ]
    )
    if "faster-whisper" in ordered:
        # Whisper is the multilingual workhorse; on Apple Silicon prefer
        # MLX when the model is installed, and fast quality prefers
        # faster-whisper directly.
        if hardware.apple_silicon and "mlx-whisper-large-v3-turbo-q4" in hardware.installed_models:
            ordered.insert(0, "mlx-whisper")
        elif quality == "fast":
            ordered = ["faster-whisper", *[p for p in ordered if p != "faster-whisper"]]

    primary = next(
        (provider for provider in ordered if _provider_installed(provider, hardware)), None
    )
    if primary is None:
        return RecognitionPlan(
            primary_provider_id="",
            fallback_provider_id=None,
            language_hint=None,
            allowed_languages=(),
            contextual_prompt_id=None,
            allow_fallback=False,
            reason=(
                "no installed provider for the requested language; "
                "install a matching model on the Models page"
            ),
        )
    fallback = next(
        (
            provider
            for provider in ordered
            if provider != primary and _provider_installed(provider, hardware)
        ),
        None,
    )
    return RecognitionPlan(
        primary_provider_id=primary,
        fallback_provider_id=fallback,
        language_hint=language_hint,
        allowed_languages=allowed,
        contextual_prompt_id=request.domain_preset_id,
        allow_fallback=quality in {"balanced", "best_quality"},
        reason=(
            f"language '{language_key}' -> {primary}"
            + (f", fallback {fallback}" if fallback else "")
            + f" ({hardware.operating_system}/{hardware.architecture})"
        ),
    )
