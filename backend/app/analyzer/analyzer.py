"""Worker de análise do Hydra Creator.

Gera três artefatos JSON a partir de um vídeo horizontal:
  - crop_keyframes.json  → janela de crop 9:16 seguindo rosto/ação (MediaPipe, a cada 2s)
  - vad_segments.json    → segmentos de fala/silêncio (Silero VAD)
  - transcript.json      → transcrição word-level (faster-whisper)

Uso:
    python -m app.analyzer.analyzer --input video.mp4 --output-dir output/analysis
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from .models import (
    AnalysisResult,
    CropKeyframe,
    CropKeyframesResult,
    TranscriptResult,
    TranscriptSegment,
    TranscriptWord,
    VADResult,
    VADSegment,
    VideoMetadata,
)
from .utils import compute_vertical_crop, extract_audio_wav, extract_metadata

logger = logging.getLogger("hydra.analyzer")

# Suavização EMA do centro do crop — evita movimento robótico entre keyframes.
EMA_ALPHA = 0.35

# Modelo de detecção facial da MediaPipe Tasks API (build atual não tem mp.solutions).
# Baixado uma vez para .models/ — mesma categoria do download automático do Whisper.
FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)


def _get_face_model_path() -> str:
    """Retorna o path do modelo .tflite, baixando para .models/ se ausente."""
    import urllib.request

    models_dir = Path(__file__).resolve().parents[2] / ".models"
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "blaze_face_short_range.tflite"
    if not model_path.exists():
        logger.info("Baixando modelo de detecção facial MediaPipe (%s)...", FACE_MODEL_URL)
        urllib.request.urlretrieve(FACE_MODEL_URL, model_path)
    return str(model_path)


def _create_face_detector():
    """Cria um FaceDetector da Tasks API do MediaPipe."""
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.FaceDetectorOptions(
        base_options=mp_python.BaseOptions(model_asset_path=_get_face_model_path()),
        min_detection_confidence=0.5,
        running_mode=vision.RunningMode.IMAGE,
    )
    return vision.FaceDetector.create_from_options(options)


# ---------------------------------------------------------------------------
# Crop keyframes (MediaPipe)
# ---------------------------------------------------------------------------

def detect_crop_keyframes(
    video_path: str,
    metadata: VideoMetadata,
    interval_sec: float = 2.0,
) -> CropKeyframesResult:
    """Amostra o vídeo a cada `interval_sec` e calcula a janela de crop 9:16.

    Estratégia: MediaPipe Face Detection no frame amostrado; quando não há rosto,
    cai para detecção de saliência simples por movimento ("gameplay") e, em último
    caso, crop central. Centro suavizado por EMA para movimento orgânico.
    Leitura sequencial com seek por índice de frame — não carrega o vídeo na memória,
    funciona para vídeos de até 4h.
    """
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV não conseguiu abrir {video_path}")

    fps = metadata.fps
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or int(metadata.duration_sec * fps)
    frame_step = max(1, int(round(interval_sec * fps)))

    keyframes: list[CropKeyframe] = []
    smoothed_cx: float | None = None
    prev_gray = None

    detector = _create_face_detector()
    try:
        for frame_idx in range(0, total_frames, frame_step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                logger.warning("Frame %d ilegível; pulando.", frame_idx)
                continue

            t_sec = frame_idx / fps
            h, w = frame.shape[:2]

            center_x, confidence, source = _find_point_of_interest(frame, detector, prev_gray)
            prev_gray = cv2.cvtColor(cv2.resize(frame, (w // 4, h // 4)), cv2.COLOR_BGR2GRAY)

            if center_x is None:
                center_x, confidence, source = w / 2, 0.0, "center"

            # Suavização EMA do centro para não gerar cortes bruscos entre keyframes
            if smoothed_cx is None:
                smoothed_cx = center_x
            else:
                smoothed_cx = EMA_ALPHA * center_x + (1 - EMA_ALPHA) * smoothed_cx

            cx, cy, cw, ch = compute_vertical_crop(smoothed_cx, w, h)
            keyframes.append(
                CropKeyframe(t_sec=round(t_sec, 3), x=cx, y=cy, w=cw, h=ch, confidence=round(confidence, 3), source=source)
            )
    finally:
        detector.close()
        cap.release()

    if not keyframes:
        logger.warning("Nenhum keyframe gerado; usando crop central único.")
        cx, cy, cw, ch = compute_vertical_crop(metadata.width / 2, metadata.width, metadata.height)
        keyframes = [CropKeyframe(t_sec=0.0, x=cx, y=cy, w=cw, h=ch, confidence=0.0, source="center")]

    return CropKeyframesResult(
        video_id=Path(video_path).stem,
        source_width=metadata.width,
        source_height=metadata.height,
        keyframes=keyframes,
    )


def _find_point_of_interest(frame, detector, prev_gray):
    """Retorna (center_x, confidence, source) do ponto de interesse do frame."""
    import cv2
    import mediapipe as mp

    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)

    if result.detections:
        best = max(result.detections, key=lambda d: d.categories[0].score if d.categories else 0.0)
        box = best.bounding_box  # origin_x/origin_y/width/height em pixels
        center_x = box.origin_x + box.width / 2
        score = float(best.categories[0].score) if best.categories else 0.5
        return center_x, score, "face"

    # Fallback "gameplay": centroide da região com mais movimento vs frame anterior
    if prev_gray is not None:
        small = cv2.cvtColor(cv2.resize(frame, (w // 4, h // 4)), cv2.COLOR_BGR2GRAY)
        if small.shape == prev_gray.shape:
            diff = cv2.absdiff(small, prev_gray)
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            moments = cv2.moments(thresh)
            if moments["m00"] > 1000:  # movimento suficiente para ser confiável
                center_x = (moments["m10"] / moments["m00"]) * 4
                return center_x, 0.4, "gameplay"

    return None, 0.0, "center"


# ---------------------------------------------------------------------------
# VAD (Silero)
# ---------------------------------------------------------------------------

def _read_wav_tensor(audio_wav_path: str):
    """Carrega WAV PCM16 mono como tensor float32 normalizado.

    Substitui silero_vad.read_audio, que depende do I/O do torchaudio
    (quebrado em torchaudio>=2.9 sem torchcodec). O WAV já vem do ffmpeg
    em 16kHz mono PCM16, então a leitura direta é suficiente.
    """
    import wave

    import numpy as np
    import torch

    with wave.open(audio_wav_path, "rb") as wf:
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return torch.from_numpy(samples)


def detect_voice_activity(audio_wav_path: str, total_duration_sec: float) -> VADResult:
    """Roda Silero VAD no WAV 16kHz e retorna segmentos contíguos de fala/silêncio."""
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()
    wav = _read_wav_tensor(audio_wav_path)
    speech_ts = get_speech_timestamps(wav, model, sampling_rate=16000, return_seconds=True)

    segments: list[VADSegment] = []
    cursor = 0.0
    for ts in speech_ts:
        start, end = float(ts["start"]), float(ts["end"])
        if start > cursor:
            segments.append(VADSegment(start_sec=round(cursor, 3), end_sec=round(start, 3), is_speech=False))
        segments.append(VADSegment(start_sec=round(start, 3), end_sec=round(end, 3), is_speech=True))
        cursor = end
    if cursor < total_duration_sec:
        segments.append(VADSegment(start_sec=round(cursor, 3), end_sec=round(total_duration_sec, 3), is_speech=False))

    if not segments:
        logger.warning("VAD não retornou segmentos; marcando vídeo inteiro como silêncio.")
        segments = [VADSegment(start_sec=0.0, end_sec=round(total_duration_sec, 3), is_speech=False)]

    return VADResult(segments=segments)


# ---------------------------------------------------------------------------
# Transcrição (faster-whisper)
# ---------------------------------------------------------------------------

def transcribe(audio_wav_path: str, model_size: str = "medium", device: str = "auto") -> TranscriptResult:
    """Transcreve com word-level timestamps. device='auto' usa CUDA se disponível."""
    from faster_whisper import WhisperModel

    if device == "auto":
        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    logger.info("faster-whisper: model=%s device=%s compute_type=%s", model_size, device, compute_type)

    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(audio_wav_path, word_timestamps=True, vad_filter=True)

    all_words: list[TranscriptWord] = []
    segments: list[TranscriptSegment] = []
    for seg in segments_iter:
        seg_words = [
            TranscriptWord(
                word=w.word.strip(),
                start_sec=round(w.start, 3),
                end_sec=round(w.end, 3),
                confidence=round(max(0.0, min(1.0, w.probability)), 3),
            )
            for w in (seg.words or [])
            if w.word.strip()
        ]
        all_words.extend(seg_words)
        segments.append(
            TranscriptSegment(
                text=seg.text.strip(),
                start_sec=round(seg.start, 3),
                end_sec=round(seg.end, 3),
                words=seg_words,
            )
        )

    if not all_words:
        logger.warning("Transcrição vazia (sem fala detectável no áudio).")

    return TranscriptResult(language=info.language or "unknown", words=all_words, segments=segments)


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------

def analyze_video(
    video_path: str,
    output_dir: str,
    interval_sec: float = 2.0,
    whisper_model_size: str | None = None,
    whisper_device: str | None = None,
    min_clip_sec: float = 15.0,
    max_clip_sec: float = 60.0,
    progress_cb=None,
) -> AnalysisResult:
    """Roda o pipeline completo de análise e grava os 4 JSONs em output_dir.

    `progress_cb(fraction, step)` é opcional — usado pela API para expor o
    andamento do job ao frontend.
    """
    def report(fraction: float, step: str) -> None:
        if progress_cb is not None:
            progress_cb(fraction, step)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    whisper_model_size = whisper_model_size or os.getenv("WHISPER_MODEL_SIZE", "medium")
    whisper_device = whisper_device or os.getenv("WHISPER_DEVICE", "auto")
    max_duration = float(os.getenv("MAX_VIDEO_DURATION_SEC", str(4 * 3600)))

    report(0.02, "Extraindo metadados")
    logger.info("Extraindo metadados de %s", video_path)
    metadata = extract_metadata(video_path, max_duration_sec=max_duration)
    logger.info(
        "Vídeo: %dx%d @ %.2ffps, %.1fs, codec=%s, audio=%s",
        metadata.width, metadata.height, metadata.fps, metadata.duration_sec,
        metadata.video_codec, metadata.audio_codec,
    )

    report(0.08, "Detectando enquadramento (crop 9:16)")
    logger.info("Detectando crop keyframes (MediaPipe, a cada %.1fs)...", interval_sec)
    crop_result = detect_crop_keyframes(video_path, metadata, interval_sec=interval_sec)
    crop_path = out / "crop_keyframes.json"
    crop_path.write_text(crop_result.model_dump_json(indent=2), encoding="utf-8")
    logger.info("→ %s (%d keyframes)", crop_path, len(crop_result.keyframes))

    audio_wav: str | None = None
    if metadata.has_audio:
        report(0.40, "Extraindo áudio")
        logger.info("Extraindo áudio para análise...")
        audio_wav = extract_audio_wav(video_path)

        report(0.48, "Detectando fala (VAD)")
        logger.info("Rodando Silero VAD...")
        vad_result = detect_voice_activity(audio_wav, metadata.duration_sec)

        report(0.55, "Transcrevendo (Whisper)")
        logger.info("Transcrevendo com faster-whisper (%s)...", whisper_model_size)
        transcript_result = transcribe(audio_wav, model_size=whisper_model_size, device=whisper_device)
    else:
        logger.warning("Vídeo sem áudio — VAD e transcript vazios.")
        vad_result = VADResult(
            segments=[VADSegment(start_sec=0.0, end_sec=round(metadata.duration_sec, 3), is_speech=False)]
        )
        transcript_result = TranscriptResult(language="unknown", words=[], segments=[])

    vad_path = out / "vad_segments.json"
    vad_path.write_text(vad_result.model_dump_json(indent=2), encoding="utf-8")
    logger.info("→ %s (%d segments, %.1fs de fala)", vad_path, len(vad_result.segments), vad_result.speech_duration())

    transcript_path = out / "transcript.json"
    transcript_path.write_text(transcript_result.model_dump_json(indent=2), encoding="utf-8")
    logger.info("→ %s (%d palavras, idioma=%s)", transcript_path, len(transcript_result.words), transcript_result.language)

    report(0.92, "Pontuando melhores cortes")
    from app.highlights import detect_highlights

    highlights = detect_highlights(
        transcript=json.loads(transcript_path.read_text(encoding="utf-8")),
        vad=json.loads(vad_path.read_text(encoding="utf-8")),
        audio_wav_path=audio_wav,
        duration_sec=metadata.duration_sec,
        min_dur=min_clip_sec,
        max_dur=max_clip_sec,
    )
    highlights_path = out / "highlights.json"
    highlights_path.write_text(json.dumps(highlights, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("→ %s (%d highlights)", highlights_path, len(highlights["highlights"]))

    report(1.0, "Análise concluída")
    return AnalysisResult(
        metadata=metadata,
        crop_keyframes_path=str(crop_path),
        vad_segments_path=str(vad_path),
        transcript_path=str(transcript_path),
        highlights_path=str(highlights_path),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hydra Creator — worker de análise")
    parser.add_argument("--input", required=True, help="Vídeo de entrada")
    parser.add_argument("--output-dir", required=True, help="Diretório dos JSONs de saída")
    parser.add_argument("--interval", type=float, default=2.0, help="Intervalo de amostragem do crop (s)")
    parser.add_argument("--whisper-model", default=None, help="Tamanho do modelo Whisper (tiny/base/small/medium/large-v3)")
    parser.add_argument("--whisper-device", default=None, choices=[None, "auto", "cuda", "cpu"], help="Dispositivo do Whisper")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        result = analyze_video(
            args.input,
            args.output_dir,
            interval_sec=args.interval,
            whisper_model_size=args.whisper_model,
            whisper_device=args.whisper_device,
        )
    except Exception as exc:  # noqa: BLE001 — CLI: reporta e retorna código de erro
        logger.error("Análise falhou: %s", exc)
        return 1

    print(json.dumps({
        "crop_keyframes": result.crop_keyframes_path,
        "vad_segments": result.vad_segments_path,
        "transcript": result.transcript_path,
        "highlights": result.highlights_path,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
