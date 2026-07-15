"""Modelos pydantic dos artefatos de análise.

Estes formatos são o contrato entre analyzer.py, transform_chain.sh,
compliance.py e o frontend (frontend/lib/types/analyzer.ts espelha em camelCase).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class VideoMetadata(BaseModel):
    path: str
    duration_sec: float
    width: int
    height: int
    fps: float
    video_codec: str
    audio_codec: Optional[str] = None
    has_audio: bool


class CropKeyframe(BaseModel):
    t_sec: float
    x: int
    y: int
    w: int
    h: int
    confidence: float = Field(ge=0.0, le=1.0)
    source: Literal["face", "gameplay", "center"]


class CropKeyframesResult(BaseModel):
    video_id: str
    source_width: int
    source_height: int
    keyframes: list[CropKeyframe]


class VADSegment(BaseModel):
    start_sec: float
    end_sec: float
    is_speech: bool


class VADResult(BaseModel):
    segments: list[VADSegment]

    def speech_duration(self) -> float:
        return sum(s.end_sec - s.start_sec for s in self.segments if s.is_speech)


class TranscriptWord(BaseModel):
    word: str
    start_sec: float
    end_sec: float
    confidence: float = Field(ge=0.0, le=1.0)


class TranscriptSegment(BaseModel):
    text: str
    start_sec: float
    end_sec: float
    words: list[TranscriptWord]


class TranscriptResult(BaseModel):
    language: str
    words: list[TranscriptWord]
    segments: list[TranscriptSegment]


class AnalysisResult(BaseModel):
    metadata: VideoMetadata
    crop_keyframes_path: str
    vad_segments_path: str
    transcript_path: str


class VideoTooLongError(Exception):
    """Vídeo excede a duração máxima suportada (default 4h)."""


class UnsupportedCodecError(Exception):
    """FFmpeg não conseguiu decodificar/normalizar a entrada."""
