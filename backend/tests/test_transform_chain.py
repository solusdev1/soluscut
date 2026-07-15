"""Teste de integração da transform chain — pulado se ffmpeg/bash não existirem.

Gera um vídeo sintético, roda transform_chain.sh e valida que a saída é 9:16.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TRANSFORM = BACKEND / "app" / "transform" / "transform_chain.sh"
FIX = Path(__file__).parent / "fixtures"

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe") and shutil.which("bash")),
    reason="ffmpeg/ffprobe/bash não disponíveis",
)


@needs_ffmpeg
def test_transform_chain_produces_vertical_clip(tmp_path):
    video = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         # 1920x1080 para casar com as fixtures (source_width/height)
         "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=4",
         "-f", "lavfi", "-i", "sine=frequency=220:duration=4",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)],
        check=True,
    )

    out = tmp_path / "out.mp4"
    subprocess.run(
        ["bash", str(TRANSFORM), str(video),
         str(FIX / "sample_crop_keyframes.json"),
         str(FIX / "sample_vad_segments.json"),
         str(FIX / "sample_transcript.json"),
         str(out), "--use-cuda=false", "--seed=1"],
        check=True,
    )

    assert out.exists() and out.stat().st_size > 0
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(out)],
        check=True, capture_output=True, text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream["width"] == 1080 and stream["height"] == 1920

    config = out.parent / "transformation_config_used.json"
    assert config.exists()
    assert json.loads(config.read_text())["renderEngine"] in {"nvenc", "libx264"}
