"""DS-700/701/702: recognition plans, hardware snapshots, routing table."""

from __future__ import annotations

import pytest

from local_squad_inference.recognition_router import (
    HardwareCapabilities,
    RecognitionPlan,
    RecognitionRequest,
    route_recognition,
    snapshot_hardware,
)

WINDOWS_GPU = HardwareCapabilities(
    operating_system="windows",
    architecture="x86_64",
    cuda_visible=True,
    usable_cuda_runtime=True,
    vram_class="high",
    apple_silicon=False,
    cpu_thread_class="high",
    installed_models=frozenset({"whisper-large-v3-turbo", "sensevoice-small"}),
)

MACOS = HardwareCapabilities(
    operating_system="macos",
    architecture="arm64",
    cuda_visible=False,
    usable_cuda_runtime=False,
    vram_class="low",
    apple_silicon=True,
    cpu_thread_class="high",
    installed_models=frozenset({"sensevoice-small"}),
)

CPU_ONLY = HardwareCapabilities(
    operating_system="windows",
    architecture="x86_64",
    cuda_visible=False,
    usable_cuda_runtime=False,
    vram_class="low",
    apple_silicon=False,
    cpu_thread_class="standard",
    installed_models=frozenset({"whisper-large-v3-turbo"}),
)


def request(
    language_config: dict[str, object],
    *,
    hardware: HardwareCapabilities,
    quality: str = "balanced",
) -> RecognitionRequest:
    return RecognitionRequest(
        source_id="s",
        language_config=language_config,
        domain_preset_id="general",
        quality_profile_id=quality,
        is_provisional=True,
        duration_ms=2000,
        hardware=hardware,
    )


class TestHardwareSnapshot:
    def test_windows_gpu_visibility_vs_usable_runtime(self) -> None:
        snapshot = snapshot_hardware(
            cuda_count=lambda: 1,
            installed_models={"whisper-large-v3-turbo"},
        )
        assert snapshot.cuda_visible is True
        assert snapshot.operating_system == "windows" or snapshot.operating_system == "macos"

    def test_gpu_probe_failure_means_no_gpu(self) -> None:
        def boom() -> int:
            raise RuntimeError("no driver")

        snapshot = snapshot_hardware(cuda_count=boom)
        assert snapshot.cuda_visible is False
        assert snapshot.vram_class == "low"

    def test_missing_models_are_recorded(self) -> None:
        snapshot = snapshot_hardware(cuda_count=lambda: 0, installed_models=set())
        assert snapshot.installed_models == frozenset()


class TestRoutingTable:
    def test_mandarin_uses_chinese_providers(self) -> None:
        plan = route_recognition(
            request(
                {"primary_language": "zh", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=CPU_ONLY,
            )
        )
        assert plan.language_hint == "zh"
        assert plan.primary_provider_id in {"faster-whisper", "sensevoice", "paraformer"}
        assert plan.reason

    def test_tagalog_uses_whisper_when_installed(self) -> None:
        plan = route_recognition(
            request(
                {"primary_language": "tl", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=CPU_ONLY,
            )
        )
        assert plan.language_hint == "tl"
        assert plan.primary_provider_id == "faster-whisper"

    def test_missing_preferred_model_degrades_to_documented_fallback(self) -> None:
        plan = route_recognition(
            request(
                {"primary_language": "zh", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=CPU_ONLY,
            )
        )
        # sensevoice not installed on CPU_ONLY -> whisper is primary.
        assert plan.primary_provider_id == "faster-whisper"
        assert plan.fallback_provider_id is None

    def test_unsupported_language_never_routes_to_unrelated_decoder(self) -> None:
        plan = route_recognition(
            request(
                {"primary_language": "ceb", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=CPU_ONLY,
            )
        )
        assert plan.primary_provider_id == ""
        assert "no provider supports" in plan.reason

    def test_auto_uses_no_language_hint(self) -> None:
        plan = route_recognition(
            request(
                {
                    "primary_language": None,
                    "secondary_languages": [],
                    "detection_mode": "full_auto",
                },
                hardware=CPU_ONLY,
            )
        )
        assert plan.language_hint is None
        assert plan.primary_provider_id == "faster-whisper"

    def test_quality_enables_fallback(self) -> None:
        hardware = WINDOWS_GPU
        plan = route_recognition(
            request(
                {"primary_language": "en", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=hardware,
                quality="best_quality",
            )
        )
        assert plan.allow_fallback is True
        plan_fast = route_recognition(
            request(
                {"primary_language": "en", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=hardware,
                quality="fast",
            )
        )
        assert plan_fast.allow_fallback is False

    def test_no_installed_provider_produces_visible_reason(self) -> None:
        bare = HardwareCapabilities(
            operating_system="windows",
            architecture="x86_64",
            cuda_visible=False,
            usable_cuda_runtime=False,
            vram_class="low",
            apple_silicon=False,
            cpu_thread_class="standard",
            installed_models=frozenset(),
        )
        plan = route_recognition(
            request(
                {"primary_language": "tl", "secondary_languages": [], "detection_mode": "fixed"},
                hardware=bare,
            )
        )
        assert plan.primary_provider_id == ""
        assert "install a matching model" in plan.reason


def test_plan_types_are_frozen_and_complete() -> None:
    plan = RecognitionPlan(
        primary_provider_id="faster-whisper",
        fallback_provider_id=None,
        language_hint="tl",
        allowed_languages=("tl",),
        contextual_prompt_id="general",
        allow_fallback=False,
        reason="test",
    )
    with pytest.raises(AttributeError):
        plan.primary_provider_id = "sensevoice"  # type: ignore[misc]
