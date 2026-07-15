"""FastAPI do Hydra Creator.

MVP: health check, listagem de BGM e endpoint de análise de vídeo (upload →
MediaPipe + Silero VAD + faster-whisper → JSONs). A fila (Redis+BullMQ) e o
render GPU entram depois; aqui a análise roda síncrona no threadpool.
"""

import json
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.analyzer.analyzer import analyze_video

app = FastAPI(title="Hydra Creator API", version="0.1.0")

# CORS liberado para dev (frontend roda em outra porta).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BGM_DIR = Path(__file__).parent / "transform" / "assets" / "bgm"


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/bgm/tracks")
def list_bgm_tracks() -> dict:
    """Lista trilhas livres de direitos disponíveis localmente.

    Placeholder da futura integração Epidemic Sound / Uppbeat.
    """
    tracks = []
    if BGM_DIR.exists():
        for f in sorted(BGM_DIR.glob("*.mp3")):
            tracks.append({"id": f.stem, "title": f.stem.replace("_", " ").title(), "url": f"/bgm/{f.name}"})
    return {"tracks": tracks}


@app.post("/analyze")
def analyze(video: UploadFile = File(...), whisper_model: str = "base") -> dict:
    """Recebe um vídeo, roda o worker de análise e devolve os 3 artefatos JSON.

    Roda síncrono (FastAPI executa `def` em threadpool). Em produção isto vira um
    job na fila; aqui é direto para o MVP. Retorna crop/vad/transcript já parseados,
    prontos para o TimelineEditor consumir.
    """
    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    work = Path(tempfile.mkdtemp(prefix="hydra_analyze_"))
    src = work / f"input{suffix}"
    try:
        with src.open("wb") as f:
            shutil.copyfileobj(video.file, f)

        result = analyze_video(str(src), str(work / "analysis"), whisper_model_size=whisper_model)

        return {
            "metadata": result.metadata.model_dump(),
            "crop_keyframes": json.loads(Path(result.crop_keyframes_path).read_text(encoding="utf-8")),
            "vad_segments": json.loads(Path(result.vad_segments_path).read_text(encoding="utf-8")),
            "transcript": json.loads(Path(result.transcript_path).read_text(encoding="utf-8")),
        }
    except Exception as exc:  # noqa: BLE001 — devolve erro tratado ao cliente
        raise HTTPException(status_code=422, detail=f"Falha na análise: {exc}") from exc
    finally:
        shutil.rmtree(work, ignore_errors=True)
