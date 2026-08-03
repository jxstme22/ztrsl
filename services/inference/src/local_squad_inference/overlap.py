"""Overlap detection per source (v0.4 Phase 6, BUILD_PLAN_V0_4 §5).

Detects when two utterances are open in the same source (multiple people
speaking), or when the same source's VAD sees near-simultaneous speech
activity. Feeds the certainty pipeline: a heavy-overlap utterance must not be
confidently captioned.

Calibration values are tunable defaults (spec §5), not permanent thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

OverlapPolicy = Literal["process_normally", "mark_uncertain", "suppress_heavy_overlap"]

# Initial calibration defaults (spec §5).
MILD_OVERLAP_RATIO = 0.15
HEAVY_OVERLAP_RATIO = 0.40
MINIMUM_OVERLAP_MS = 250

# Recommended defaults per source kind (spec §5).
DEFAULT_POLICIES: dict[str, OverlapPolicy] = {
    "team": "suppress_heavy_overlap",
    "discord": "mark_uncertain",
}


@dataclass(frozen=True)
class OverlapSample:
    """One VAD interval: whether it is speech and its [start, end) in ms."""

    speech: bool
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class OverlapStatus:
    policy: OverlapPolicy
    ratio: float
    overlap_ms: int
    mild: bool
    heavy: bool
    verdict: Literal["normal", "uncertain", "suppressed"]


def overlap_ratio(samples: list[OverlapSample]) -> float:
    """Fraction of speech samples that overlap another speech sample.

    A speech sample overlaps when any OTHER speech sample has an intersecting
    [start, end) interval. Ratio = overlapping frames / speech frames; 0 when
    there is no speech.
    """
    speech = [sample for sample in samples if sample.speech]
    if not speech:
        return 0.0
    overlapping = 0
    for sample in speech:
        for other in speech:
            if other is sample:
                continue
            if sample.start_ms < other.end_ms and other.start_ms < sample.end_ms:
                overlapping += 1
                break
    return overlapping / len(speech)


def total_overlap_ms(samples: list[OverlapSample]) -> int:
    """Total ms spent with two speech frames open at once (union of overlap
    windows)."""
    speech = [sample for sample in samples if sample.speech]
    intervals = sorted(((s.start_ms, s.end_ms) for s in speech), key=lambda pair: pair[0])
    merged: list[tuple[int, int]] = []
    for start, end in intervals:
        if merged and start < merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    # Overlap = total covered length - simple sum of interval lengths only when
    # intervals nest; here we compute covered duration of >=2 concurrent.
    if len(intervals) < 2:
        return 0
    points: list[tuple[int, int]] = []
    for start, end in intervals:
        points.append((start, 1))
        points.append((end, -1))
    points.sort()
    depth = 0
    overlap = 0
    prev = points[0][0]
    for position, delta in points:
        if depth >= 2:
            overlap += position - prev
        depth += delta
        prev = position
    return max(0, overlap)


def classify_overlap(
    samples: list[OverlapSample],
    policy: OverlapPolicy,
    *,
    mild_ratio: float = MILD_OVERLAP_RATIO,
    heavy_ratio: float = HEAVY_OVERLAP_RATIO,
    minimum_overlap_ms: int = MINIMUM_OVERLAP_MS,
) -> OverlapStatus:
    """Classify a source's recent activity against its overlap policy.

    - `process_normally`: never blocks; verdict is `normal`.
    - `mark_uncertain`: mild+ overlap (above `mild_ratio`) marks uncertain;
      heavy (above `heavy_ratio`) still marks uncertain (not suppressed).
    - `suppress_heavy_overlap`: heavy overlap (above `heavy_ratio`) suppresses;
      mild marks uncertain.
    """
    ratio = overlap_ratio(samples)
    overlap_ms = total_overlap_ms(samples)
    below_min = overlap_ms < minimum_overlap_ms

    if policy == "process_normally":
        return OverlapStatus(
            policy=policy,
            ratio=ratio,
            overlap_ms=overlap_ms,
            mild=False,
            heavy=False,
            verdict="normal",
        )
    if policy == "mark_uncertain":
        if ratio > 0 and not below_min:
            return OverlapStatus(
                policy=policy,
                ratio=ratio,
                overlap_ms=overlap_ms,
                mild=ratio >= mild_ratio,
                heavy=ratio >= heavy_ratio,
                verdict="uncertain",
            )
        return OverlapStatus(
            policy=policy,
            ratio=ratio,
            overlap_ms=overlap_ms,
            mild=False,
            heavy=False,
            verdict="normal",
        )
    # suppress_heavy_overlap
    if ratio >= heavy_ratio and not below_min:
        return OverlapStatus(
            policy=policy,
            ratio=ratio,
            overlap_ms=overlap_ms,
            mild=True,
            heavy=True,
            verdict="suppressed",
        )
    if ratio >= mild_ratio and not below_min:
        return OverlapStatus(
            policy=policy,
            ratio=ratio,
            overlap_ms=overlap_ms,
            mild=True,
            heavy=False,
            verdict="uncertain",
        )
    return OverlapStatus(
        policy=policy, ratio=ratio, overlap_ms=overlap_ms, mild=False, heavy=False, verdict="normal"
    )
