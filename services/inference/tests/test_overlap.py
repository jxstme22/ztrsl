"""v0.4 Phase 6: overlap detection tests."""

from local_squad_inference.overlap import (
    DEFAULT_POLICIES,
    OverlapSample,
    classify_overlap,
    overlap_ratio,
    total_overlap_ms,
)

TEAM = "team"
DISCORD = "discord"


def sample(speech: bool, start_ms: int, end_ms: int) -> OverlapSample:
    return OverlapSample(speech=speech, start_ms=start_ms, end_ms=end_ms)


def test_no_speech_ratio_zero() -> None:
    assert overlap_ratio([sample(False, 0, 100), sample(False, 100, 200)]) == 0.0


def test_single_speech_frame_ratio_zero() -> None:
    assert overlap_ratio([sample(True, 0, 100)]) == 0.0


def test_two_overlapping_speech_frames_ratio_one() -> None:
    frames = [sample(True, 0, 100), sample(True, 50, 150)]
    assert overlap_ratio(frames) == 1.0


def test_partial_overlap_ratio() -> None:
    # Frames 0 and 1 overlap each other (both count as overlapping); frame 2
    # (200..300) overlaps nothing -> 2/3 ≈ 0.667.
    frames = [sample(True, 0, 100), sample(True, 50, 150), sample(True, 200, 300)]
    assert abs(overlap_ratio(frames) - 2 / 3) < 1e-9


def test_total_overlap_ms() -> None:
    frames = [sample(True, 0, 100), sample(True, 50, 150)]
    assert total_overlap_ms(frames) == 50
    frames = [sample(True, 0, 100), sample(True, 50, 200), sample(True, 150, 250)]
    assert total_overlap_ms(frames) == 100  # 50..150 double, 150..200 double


def test_process_normally_never_suppresses() -> None:
    heavy = [sample(True, 0, 1000), sample(True, 100, 900)]
    status = classify_overlap(heavy, "process_normally")
    assert status.verdict == "normal"


def test_mark_uncertain_flags_mild_and_heavy() -> None:
    # Two fully-overlapping long frames: ratio 1.0, overlap 300ms >= min.
    mild = [sample(True, 0, 400), sample(True, 100, 500)]
    status = classify_overlap(mild, "mark_uncertain")
    assert status.verdict == "uncertain"
    assert status.mild


def test_suppress_heavy_suppresses_only_heavy() -> None:
    heavy = [sample(True, 0, 1000), sample(True, 100, 900)]
    status = classify_overlap(heavy, "suppress_heavy_overlap")
    assert status.verdict == "suppressed"
    assert status.heavy


def test_suppress_heavy_marks_mild_uncertain() -> None:
    # Two short overlapping frames totalling < minimum_overlap_ms -> normal.
    brief = [sample(True, 0, 100), sample(True, 50, 150)]
    status = classify_overlap(brief, "suppress_heavy_overlap", minimum_overlap_ms=250)
    assert status.verdict == "normal"
    # Ratio between mild and heavy: 6 long frames, only one pair overlaps
    # (2/6 ≈ 0.33, which is >= mild 0.15 but < heavy 0.40).
    mild = [
        sample(True, 0, 400),
        sample(True, 100, 500),
        sample(True, 900, 1300),
        sample(True, 1500, 1900),
        sample(True, 2100, 2500),
        sample(True, 2700, 3100),
    ]
    status = classify_overlap(mild, "suppress_heavy_overlap", minimum_overlap_ms=250)
    assert status.verdict == "uncertain"
    assert status.mild and not status.heavy


def test_below_minimum_overlap_stays_normal() -> None:
    frames = [sample(True, 0, 100), sample(True, 50, 150)]
    status = classify_overlap(frames, "suppress_heavy_overlap")
    assert status.verdict == "normal"


def test_default_policies() -> None:
    assert DEFAULT_POLICIES[TEAM] == "suppress_heavy_overlap"
    assert DEFAULT_POLICIES[DISCORD] == "mark_uncertain"
