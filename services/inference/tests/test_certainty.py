"""v0.4 Phase 5: certainty state tests."""

from local_squad_inference.profiles import GateDecision
from local_squad_inference.protocol import CaptionCertainty, CaptionPayload
from local_squad_inference.sidecar import _certainty_for


def base_caption() -> CaptionPayload:
    return CaptionPayload(
        caption_id="live-utterance-1",
        utterance_id="utterance-1",
        revision=2,
        status="final",
        source_mode="filipino",
        source_text="rush B",
        english_text="Rush B",
        started_monotonic_ns=1000,
        ended_monotonic_ns=2000,
        capture_to_caption_ms=100.0,
        asr_ms=50.0,
        translation_ms=10.0,
        confidence=0.9,
        warnings=[],
        source_id="11111111111111111111111111111111",
    )


def test_normal_certainty_is_none() -> None:
    caption = base_caption()
    assert _certainty_for(caption, GateDecision(applied="passed"), None) is None


def test_suppressed_gate_maps_to_suppressed() -> None:
    caption = base_caption()
    certainty = _certainty_for(
        caption, GateDecision(applied="suppressed", reason="low_confidence"), None
    )
    assert certainty is not None
    assert certainty.state == "suppressed"
    assert certainty.suppression_reason == "low_confidence"


def test_flagged_maps_to_unexpected_language() -> None:
    caption = base_caption()
    certainty = _certainty_for(
        caption, GateDecision(applied="flagged", reason="language_mismatch"), None
    )
    assert certainty is not None
    assert certainty.state == "uncertain"
    assert "unexpected_language" in certainty.uncertainty_reasons


def test_low_confidence_adds_reason() -> None:
    caption = base_caption()
    caption = caption.model_copy(update={"confidence": 0.2})
    certainty = _certainty_for(caption, GateDecision(applied="passed"), None)
    assert certainty is not None
    assert certainty.state == "uncertain"
    assert "low_asr_confidence" in certainty.uncertainty_reasons


def test_heavy_overlap_suppresses() -> None:
    class _Status:
        verdict = "suppressed"

    caption = base_caption()
    certainty = _certainty_for(caption, GateDecision(applied="passed"), lambda source_id: _Status())
    assert certainty is not None
    assert certainty.state == "suppressed"
    assert certainty.suppression_reason == "heavy_overlap"


def test_mild_overlap_marks_uncertain() -> None:
    class _Status:
        verdict = "uncertain"

    caption = base_caption()
    certainty = _certainty_for(caption, GateDecision(applied="passed"), lambda source_id: _Status())
    assert certainty is not None
    assert certainty.state == "uncertain"
    assert "overlapping_speech" in certainty.uncertainty_reasons


def test_serializes_to_wire_shape() -> None:
    certainty = CaptionCertainty(
        state="uncertain", uncertainty_reasons=["overlapping_speech"], suppression_reason=None
    )
    data = certainty.model_dump(mode="json")
    assert data["state"] == "uncertain"
    assert data["uncertainty_reasons"] == ["overlapping_speech"]
    assert data["suppression_reason"] is None
