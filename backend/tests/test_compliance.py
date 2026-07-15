"""Testes do compliance scoring — só dependem de stdlib (rodam sem GPU/ffmpeg)."""

import json
from pathlib import Path

from app.compliance.compliance import compute_compliance_score

FIX = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def _inputs():
    return (
        _load("sample_crop_keyframes.json"),
        _load("sample_vad_segments.json"),
        _load("sample_transcript.json"),
        _load("sample_transformation_config.json"),
    )


def test_full_config_passes_threshold():
    crop, vad, tr, cfg = _inputs()
    result = compute_compliance_score(crop, vad, tr, cfg)
    assert result.overall_score >= 70
    assert result.passed_threshold is True
    assert set(result.breakdown) == set(result.weights)


def test_zero_grain_reduces_visual_score():
    crop, vad, tr, cfg = _inputs()
    base = compute_compliance_score(crop, vad, tr, cfg)
    cfg_no_grain = {**cfg, "grainOpacity": 0.0}
    reduced = compute_compliance_score(crop, vad, tr, cfg_no_grain)
    assert reduced.breakdown["visual_effects_score"] < base.breakdown["visual_effects_score"]
    assert reduced.overall_score < base.overall_score


def test_no_audio_shift_zeroes_audio_score():
    crop, vad, tr, cfg = _inputs()
    cfg_flat = {**cfg, "pitchShiftPercent": 0, "speedPercent": 0}
    result = compute_compliance_score(crop, vad, tr, cfg_flat)
    assert result.breakdown["audio_shift_score"] == 0.0


def test_static_crop_penalized():
    _, vad, tr, cfg = _inputs()
    static_crop = {
        "source_width": 1920,
        "source_height": 1080,
        "keyframes": [
            {"t_sec": 0.0, "x": 640, "y": 0, "w": 606, "h": 1080, "confidence": 0.9, "source": "face"},
            {"t_sec": 5.0, "x": 640, "y": 0, "w": 606, "h": 1080, "confidence": 0.9, "source": "face"},
        ],
    }
    result = compute_compliance_score(static_crop, vad, tr, cfg)
    assert result.breakdown["crop_variation_score"] <= 20
