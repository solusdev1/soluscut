"""Helpers de ffprobe/ffmpeg e utilidades do analyzer."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from .models import UnsupportedCodecError, VideoMetadata, VideoTooLongError

logger = logging.getLogger("hydra.analyzer")

MAX_VIDEO_DURATION_SEC = 4 * 60 * 60  # 4 horas


def _require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"'{name}' não encontrado no PATH. Instale o FFmpeg (https://ffmpeg.org).")
    return path


def extract_metadata(video_path: str, max_duration_sec: float = MAX_VIDEO_DURATION_SEC) -> VideoMetadata:
    """Extrai metadados via ffprobe. Levanta VideoTooLongError se exceder o limite."""
    _require_binary("ffprobe")
    src = Path(video_path)
    if not src.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_path}")

    cmd = [
        "ffprobe", "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(src),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise UnsupportedCodecError(f"ffprobe falhou em {video_path}: {proc.stderr.strip()}")

    data = json.loads(proc.stdout)
    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if video_stream is None:
        raise UnsupportedCodecError(f"Nenhum stream de vídeo em {video_path}")

    duration = float(data.get("format", {}).get("duration") or video_stream.get("duration") or 0.0)
    if duration <= 0:
        raise UnsupportedCodecError(f"Duração inválida em {video_path}")
    if duration > max_duration_sec:
        raise VideoTooLongError(
            f"Vídeo tem {duration / 3600:.1f}h; máximo suportado é {max_duration_sec / 3600:.1f}h."
        )

    # fps pode vir como fração "30000/1001"
    rate = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "30/1"
    try:
        num, den = rate.split("/")
        fps = float(num) / float(den) if float(den) != 0 else 30.0
    except (ValueError, ZeroDivisionError):
        fps = 30.0

    return VideoMetadata(
        path=str(src),
        duration_sec=duration,
        width=int(video_stream["width"]),
        height=int(video_stream["height"]),
        fps=fps,
        video_codec=video_stream.get("codec_name", "unknown"),
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
        has_audio=audio_stream is not None,
    )


def extract_audio_wav(video_path: str, out_path: str | None = None, sample_rate: int = 16000) -> str:
    """Extrai o áudio como WAV mono 16kHz (formato esperado por Silero VAD e Whisper).

    Normaliza qualquer codec de entrada — evita falhas de decode em containers exóticos.
    """
    _require_binary("ffmpeg")
    if out_path is None:
        out_path = str(Path(tempfile.mkdtemp(prefix="hydra_audio_")) / "audio.wav")

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le",
        "-ar", str(sample_rate), "-ac", "1",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise UnsupportedCodecError(f"Falha ao extrair áudio de {video_path}: {proc.stderr.strip()}")
    return out_path


def compute_vertical_crop(
    center_x: float,
    source_width: int,
    source_height: int,
    aspect: float = 9 / 16,
) -> tuple[int, int, int, int]:
    """Calcula janela de crop 9:16 de altura máxima centrada em center_x.

    Retorna (x, y, w, h) clampado aos limites do frame, com w/h pares (exigência de encoders yuv420p).
    """
    h = source_height
    w = int(h * aspect)
    if w > source_width:
        w = source_width
        h = int(w / aspect)
    w -= w % 2
    h -= h % 2

    x = int(center_x - w / 2)
    x = max(0, min(x, source_width - w))
    y = (source_height - h) // 2
    return x, y, w, h
