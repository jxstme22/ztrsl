"""DS-300..DS-402: audio health metrics, health states, normalization,
source-origin policies, calibration recommendations, and VAD profiles."""

from __future__ import annotations

import math

import pytest

from local_squad_inference.audio_health import (
    CLIPPING,
    DISCONNECTED,
    FORMAT_ERROR,
    MONITORING_LOOP,
    OVERLOADED,
    READY,
    SILENT,
    VERY_QUIET,
    AudioHealthMetrics,
    ProcessingOverrides,
    SourceProcessingPolicy,
    calibration_recommendations,
    classify_source_health,
    normalize_audio,
    policy_for_origin,
    resolve_processing_policy,
)
from local_squad_inference.vad import VAD_PROFILES, vad_config_for_profile


def _frame(
    *, rms: float, count: int = 160, clip: bool = False, zero: bool = False
) -> tuple[float, ...]:
    amplitude = rms * math.sqrt(2)
    if zero:
        return tuple(0.0 for _ in range(count))
    if clip:
        return tuple(1.0 if index % 2 == 0 else -1.0 for index in range(count))
    return tuple(amplitude for _ in range(count))


class TestAudioHealthMetrics:
    def test_observe_frame_tracks_signal_stats(self) -> None:
        health = AudioHealthMetrics()
        health.observe_frame(_frame(rms=0.2), speech=True)
        health.observe_frame(_frame(rms=0.0, zero=True), speech=False)
        snapshot = health.snapshot()
        assert snapshot["frames"] == 2
        assert snapshot["peak"] == pytest.approx(0.2 * math.sqrt(2), abs=1e-3)
        assert snapshot["speech_frame_ratio"] == pytest.approx(0.5)
        assert snapshot["zero_ratio"] == pytest.approx(0.5)

    def test_non_finite_samples_are_counted_not_crashed(self) -> None:
        health = AudioHealthMetrics()
        health.observe_frame(tuple([0.1, float("nan"), float("inf"), 0.2] * 40), speech=False)
        assert health.non_finite_samples == 80
        rms = health.snapshot()["rms"]
        assert isinstance(rms, (int, float)) and math.isfinite(float(rms))


class TestClassifySourceHealth:
    def test_ready_when_healthy(self) -> None:
        health = AudioHealthMetrics()
        health.observe_frame(_frame(rms=0.1), speech=True)
        assert classify_source_health(health).state == READY

    def test_silent_after_long_silence(self) -> None:
        health = AudioHealthMetrics()
        for _ in range(450):
            health.observe_frame(_frame(rms=0.0, zero=True), speech=False)
        assert classify_source_health(health).state == SILENT

    def test_very_quiet(self) -> None:
        health = AudioHealthMetrics()
        for _ in range(10):
            health.observe_frame(_frame(rms=0.001), speech=False)
        assert classify_source_health(health).state == VERY_QUIET

    def test_clipping(self) -> None:
        health = AudioHealthMetrics()
        for _ in range(10):
            health.observe_frame(_frame(rms=0.5, clip=True), speech=True)
        assert classify_source_health(health).state == CLIPPING

    def test_overloaded_by_queue_depth(self) -> None:
        health = AudioHealthMetrics()
        health.queue_depth = 8
        health.observe_frame(_frame(rms=0.1), speech=True)
        assert classify_source_health(health).state == OVERLOADED

    def test_format_error_and_disconnected_win_priority(self) -> None:
        health = AudioHealthMetrics()
        health.queue_depth = 9
        classified = classify_source_health(health, format_error=True)
        assert classified.state == FORMAT_ERROR
        classified = classify_source_health(health, disconnected=True)
        assert classified.state == DISCONNECTED

    def test_monitoring_loop_suspected(self) -> None:
        health = AudioHealthMetrics()
        health.observe_frame(_frame(rms=0.1), speech=True)
        assert classify_source_health(health, monitoring_loop=True).state == MONITORING_LOOP

    def test_every_state_has_explanation_and_action(self) -> None:
        for state in (
            READY,
            SILENT,
            VERY_QUIET,
            CLIPPING,
            FORMAT_ERROR,
            OVERLOADED,
            DISCONNECTED,
            MONITORING_LOOP,
        ):
            marker = AudioHealthMetrics()
            if state == OVERLOADED:
                marker.queue_depth = 9
            elif state == SILENT:
                for _ in range(450):
                    marker.observe_frame(_frame(rms=0.0, zero=True), speech=False)
            elif state == VERY_QUIET:
                for _ in range(10):
                    marker.observe_frame(_frame(rms=0.001), speech=False)
            elif state == CLIPPING:
                for _ in range(10):
                    marker.observe_frame(_frame(rms=0.5, clip=True), speech=True)
            elif state == DISCONNECTED:
                marker.packets_received = 0
            else:
                marker.observe_frame(_frame(rms=0.1), speech=True)
            result = classify_source_health(
                marker,
                format_error=state == FORMAT_ERROR,
                disconnected=state == DISCONNECTED,
                monitoring_loop=state == MONITORING_LOOP,
            )
            assert result.state == state
            assert result.explanation
            assert result.recommended_action


class TestNormalizeAudio:
    def test_quiet_speech_gets_bounded_gain(self) -> None:
        samples = tuple(0.001 for _ in range(160))
        normalized, applied = normalize_audio(samples, enabled=True)
        assert applied is True
        rms = math.sqrt(sum(s * s for s in normalized) / len(normalized))
        assert rms >= 0.003

    def test_loud_speech_is_not_amplified(self) -> None:
        samples = tuple(0.5 for _ in range(160))
        normalized, applied = normalize_audio(samples, enabled=True)
        assert applied is False
        assert normalized == samples

    def test_normal_speech_almost_unchanged(self) -> None:
        samples = tuple(0.05 for _ in range(160))
        _normalized, applied = normalize_audio(samples, enabled=True)
        assert applied is False

    def test_non_finite_and_disabled_are_untouched(self) -> None:
        samples = tuple([0.01, float("nan")] * 80)
        normalized, applied = normalize_audio(samples, enabled=True)
        assert applied is False
        assert normalized == samples
        _, applied = normalize_audio(samples, enabled=False)
        assert applied is False

    def test_gain_is_capped(self) -> None:
        samples = tuple(1e-9 for _ in range(160))
        normalized, applied = normalize_audio(samples, enabled=True)
        assert applied is True
        peak = max(abs(sample) for sample in normalized)
        assert peak <= 1.0


class TestSourceOriginPolicy:
    def test_origin_defaults(self) -> None:
        assert policy_for_origin("virtual_voice_channel").normalize is False
        assert policy_for_origin("physical_microphone").normalize is True
        assert policy_for_origin("system_mix").strict_speech_validation is True
        assert policy_for_origin("recorded_file").vad_enabled is False
        assert policy_for_origin("unknown-origin") == SourceProcessingPolicy()

    def test_user_override_wins(self) -> None:
        resolved = resolve_processing_policy(
            "physical_microphone",
            overrides=ProcessingOverrides(normalize=False),
        )
        assert resolved.normalize is False
        resolved = resolve_processing_policy(
            "virtual_voice_channel",
            overrides=ProcessingOverrides(normalize=True),
        )
        assert resolved.normalize is True


class TestCalibrationRecommendations:
    def test_short_fragments_recommend_longer_silence(self) -> None:
        health = AudioHealthMetrics()
        health.short_fragment_count = 6
        recommendations = calibration_recommendations(health)
        assert any("end-silence" in item for item in recommendations)

    def test_forced_splits_recommend_longer_utterances(self) -> None:
        health = AudioHealthMetrics()
        health.forced_split_count = 4
        recommendations = calibration_recommendations(health)
        assert any("maximum utterance" in item for item in recommendations)

    def test_quiet_input_recommends_normalization(self) -> None:
        health = AudioHealthMetrics()
        for _ in range(10):
            health.observe_frame(_frame(rms=0.001), speech=False)
        recommendations = calibration_recommendations(health)
        assert any("normalization" in item for item in recommendations)

    def test_healthy_input_has_no_recommendations(self) -> None:
        health = AudioHealthMetrics()
        for _ in range(10):
            health.observe_frame(_frame(rms=0.1), speech=True)
        assert calibration_recommendations(health) == []


class TestVadProfiles:
    def test_profiles_exist_with_expected_timings(self) -> None:
        assert vad_config_for_profile("fast_callouts").pre_roll_ms == 320
        assert vad_config_for_profile("natural_conversation").min_silence_ms == 750
        assert vad_config_for_profile("meeting").max_utterance_ms == 40_000

    def test_all_presets_reference_valid_profiles(self) -> None:
        from local_squad_inference.audio_health import policy_for_origin  # noqa: F401

        for profile_id in VAD_PROFILES:
            assert vad_config_for_profile(profile_id).max_utterance_ms >= 12_000

    def test_unknown_profile_raises(self) -> None:
        with pytest.raises(ValueError):
            vad_config_for_profile("no-such-profile")
