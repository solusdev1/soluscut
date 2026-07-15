"""Testes das partes puras do analyzer/geradores (sem GPU, ffmpeg opcional)."""

import json
from pathlib import Path

import pytest

from app.analyzer.utils import compute_vertical_crop

FIX = Path(__file__).parent / "fixtures"


def test_compute_vertical_crop_is_916_and_even():
    x, y, w, h = compute_vertical_crop(center_x=960, source_width=1920, source_height=1080)
    assert w % 2 == 0 and h % 2 == 0
    assert abs((w / h) - (9 / 16)) < 0.02
    assert 0 <= x <= 1920 - w


def test_compute_vertical_crop_clamps_left_edge():
    x, _, w, _ = compute_vertical_crop(center_x=0, source_width=1920, source_height=1080)
    assert x == 0  # não sai do frame à esquerda


def test_compute_vertical_crop_clamps_right_edge():
    x, _, w, _ = compute_vertical_crop(center_x=1920, source_width=1920, source_height=1080)
    assert x == 1920 - w  # não sai do frame à direita


def test_generate_ass_highlights_keywords():
    from app.transform.generate_ass import generate_ass

    transcript = json.loads((FIX / "sample_transcript.json").read_text(encoding="utf-8"))
    ass = generate_ass(transcript, font="Montserrat", play_res=(1080, 1920), pop_scale=120)
    assert "[Events]" in ass
    assert "Dialogue:" in ass
    # keyword "EXPLOSÃO" deve aparecer em maiúsculas com cor neon
    assert "EXPLOSÃO" in ass
    assert "&H0000F7FF" in ass  # amarelo neon


def test_generate_filters_produces_expressions(tmp_path):
    from app.transform.generate_filters import build_bgm_volume_filter, build_crop_filter

    crop = json.loads((FIX / "sample_crop_keyframes.json").read_text(encoding="utf-8"))
    vad = json.loads((FIX / "sample_vad_segments.json").read_text(encoding="utf-8"))

    crop_filter = build_crop_filter(
        crop, zoom_min=1.0, zoom_max=1.15, zoom_interval_range=(10, 15),
        duration_sec=10, seed=42,
    )
    assert crop_filter.startswith("crop=")

    vol_filter = build_bgm_volume_filter(vad, duck_speech=0.15, duck_silence=0.80, crossfade_sec=0.5)
    assert vol_filter.startswith("volume=")
    assert "0.1500" in vol_filter and "0.8000" in vol_filter
