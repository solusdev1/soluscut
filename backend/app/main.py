"""FastAPI do Hydra Creator.

Fluxo completo do MVP:
  1. POST /videos            → upload; análise roda em background (job)
  2. GET  /jobs/{job_id}     → progresso (fração + etapa)
  3. GET  /videos/{id}       → metadados + crop/vad/transcript + highlights com score
  4. POST /videos/{id}/render→ render em background do trecho escolhido
                                (crop dinâmico + legendas animadas + BGM opcional)
  5. GET  /renders/{id}/file → download do clipe final .mp4

Os uploads e artefatos ficam em backend/storage/ (HYDRA_STORAGE_DIR), então
análises sobrevivem a restart. Jobs são registrados em memória e os pesados
rodam num ThreadPoolExecutor — em produção viram fila (Redis) sem mudar a API.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.analyzer.analyzer import analyze_video
from app.render import RenderOptions, render_clip

logger = logging.getLogger("hydra.api")

app = FastAPI(title="Hydra Creator API", version="0.2.0")

# CORS liberado para dev (frontend roda em outra porta).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BGM_DIR = Path(__file__).parent / "transform" / "assets" / "bgm"
STORAGE_DIR = Path(os.getenv("HYDRA_STORAGE_DIR", Path(__file__).resolve().parents[1] / "storage"))
UPLOADS_DIR = STORAGE_DIR / "uploads"
RENDERS_DIR = STORAGE_DIR / "renders"
for d in (UPLOADS_DIR, RENDERS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Análise e render são CPU/GPU-bound: 2 workers evitam brigar pela GPU.
_executor = ThreadPoolExecutor(max_workers=2)
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Job registry
# ---------------------------------------------------------------------------

def _create_job(kind: str, **extra) -> dict:
    job = {
        "job_id": uuid.uuid4().hex[:12],
        "kind": kind,
        "status": "queued",     # queued | running | done | error
        "progress": 0.0,
        "step": "Na fila",
        "error": None,
        **extra,
    }
    with _jobs_lock:
        _jobs[job["job_id"]] = job
    return job


def _update_job(job_id: str, **patch) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(patch)


def _job_progress_cb(job_id: str):
    def cb(fraction: float, step: str) -> None:
        _update_job(job_id, progress=round(float(fraction), 3), step=step)
    return cb


# ---------------------------------------------------------------------------
# Helpers de storage
# ---------------------------------------------------------------------------

def _video_dir(video_id: str) -> Path:
    return UPLOADS_DIR / video_id


def _find_input_file(video_id: str) -> Path | None:
    vdir = _video_dir(video_id)
    if not vdir.exists():
        return None
    return next((f for f in vdir.iterdir() if f.stem == "input"), None)


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _analysis_payload(video_id: str) -> dict | None:
    """Monta o payload completo de análise a partir do disco (None se incompleto)."""
    adir = _video_dir(video_id) / "analysis"
    required = ["metadata.json", "crop_keyframes.json", "vad_segments.json", "transcript.json", "highlights.json"]
    if not all((adir / f).exists() for f in required):
        return None
    return {
        "video_id": video_id,
        "status": "done",
        "metadata": _read_json(adir / "metadata.json"),
        "crop_keyframes": _read_json(adir / "crop_keyframes.json"),
        "vad_segments": _read_json(adir / "vad_segments.json"),
        "transcript": _read_json(adir / "transcript.json"),
        "highlights": _read_json(adir / "highlights.json")["highlights"],
    }


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------

def _run_analysis(job_id: str, video_id: str, src: Path, whisper_model: str,
                  min_clip_sec: float, max_clip_sec: float) -> None:
    _update_job(job_id, status="running", step="Iniciando análise")
    try:
        result = analyze_video(
            str(src),
            str(_video_dir(video_id) / "analysis"),
            whisper_model_size=whisper_model,
            min_clip_sec=min_clip_sec,
            max_clip_sec=max_clip_sec,
            progress_cb=_job_progress_cb(job_id),
        )
        meta_path = _video_dir(video_id) / "analysis" / "metadata.json"
        meta_path.write_text(result.metadata.model_dump_json(indent=2), encoding="utf-8")
        _update_job(job_id, status="done", progress=1.0, step="Análise concluída")
    except Exception as exc:  # noqa: BLE001 — erro vai para o job, não derruba o worker
        logger.exception("Análise do vídeo %s falhou", video_id)
        _update_job(job_id, status="error", error=str(exc), step="Erro na análise")


def _run_render(job_id: str, render_id: str, video_id: str, src: Path, req: "RenderRequest") -> None:
    _update_job(job_id, status="running", step="Iniciando render")
    try:
        bgm_path = None
        if req.bgm_id:
            candidate = BGM_DIR / f"{req.bgm_id}.mp3"
            if candidate.exists():
                bgm_path = str(candidate)
        output = RENDERS_DIR / f"{render_id}.mp4"
        render_clip(
            input_video=str(src),
            analysis_dir=str(_video_dir(video_id) / "analysis"),
            output_path=str(output),
            start_sec=req.start_sec,
            end_sec=req.end_sec,
            options=RenderOptions(
                with_captions=req.with_captions,
                caption_style=req.caption_style,
                layout=req.layout,
                split_config=req.split.model_dump() if req.split else None,
                crop_override=[k.model_dump() for k in req.crop_keyframes] if req.crop_keyframes else None,
                font=req.font,
                bgm_path=bgm_path,
                pitch_percent=req.pitch_percent,
                speed_percent=req.speed_percent,
                grain=req.grain,
                seed=req.seed,
            ),
            progress_cb=_job_progress_cb(job_id),
        )
        _update_job(job_id, status="done", progress=1.0, step="Clipe pronto")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Render %s falhou", render_id)
        _update_job(job_id, status="error", error=str(exc), step="Erro no render")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CropRect(BaseModel):
    x: int
    y: int
    w: int
    h: int


class SplitConfig(BaseModel):
    topCrop: CropRect
    bottomCrop: CropRect
    ratio: float = Field(default=0.5, gt=0.0, lt=1.0)


class CropKeyframeIn(BaseModel):
    t_sec: float = 0.0
    x: int
    y: int
    w: int
    h: int


class RenderRequest(BaseModel):
    start_sec: float = Field(ge=0.0)
    end_sec: float = Field(gt=0.0)
    with_captions: bool = True
    caption_style: str = "mozi"  # mozi | beasty | karaoke | popline
    layout: str = "single"       # single | fit | split
    split: Optional[SplitConfig] = None
    # Enquadramento editado no frontend (substitui os keyframes da análise)
    crop_keyframes: Optional[list[CropKeyframeIn]] = None
    font: str = "Montserrat"
    bgm_id: Optional[str] = None
    pitch_percent: float = 0.0
    speed_percent: float = 0.0
    grain: float = Field(default=0.04, ge=0.0, le=0.3)
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/bgm/tracks")
def list_bgm_tracks() -> dict:
    """Lista trilhas livres de direitos disponíveis localmente."""
    tracks = []
    if BGM_DIR.exists():
        for f in sorted(BGM_DIR.glob("*.mp3")):
            tracks.append({"id": f.stem, "title": f.stem.replace("_", " ").title(), "url": f"/bgm/{f.name}"})
    return {"tracks": tracks}


@app.post("/videos", status_code=202)
def upload_video(
    video: UploadFile = File(...),
    whisper_model: str = Form("base"),
    min_clip_sec: float = Form(15.0),
    max_clip_sec: float = Form(60.0),
) -> dict:
    """Recebe o vídeo, guarda em storage e dispara a análise em background.

    Retorna imediatamente com video_id + job_id; o frontend acompanha via
    GET /jobs/{job_id} e busca o resultado em GET /videos/{video_id}.
    """
    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    video_id = uuid.uuid4().hex[:12]
    vdir = _video_dir(video_id)
    vdir.mkdir(parents=True, exist_ok=True)
    src = vdir / f"input{suffix}"
    try:
        with src.open("wb") as f:
            shutil.copyfileobj(video.file, f)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(vdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Falha ao salvar upload: {exc}") from exc

    job = _create_job("analysis", video_id=video_id)
    _executor.submit(_run_analysis, job["job_id"], video_id, src, whisper_model, min_clip_sec, max_clip_sec)
    return {"video_id": video_id, "job_id": job["job_id"]}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    return job


@app.get("/videos/{video_id}")
def get_video(video_id: str) -> dict:
    """Análise completa (metadados, crop, vad, transcript e highlights com score)."""
    if _find_input_file(video_id) is None:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado")
    payload = _analysis_payload(video_id)
    if payload is None:
        return {"video_id": video_id, "status": "processing"}
    return payload


@app.get("/videos/{video_id}/file")
def get_video_file(video_id: str) -> FileResponse:
    """Serve o vídeo original (player do editor pode usar como fonte)."""
    src = _find_input_file(video_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado")
    return FileResponse(src, media_type="video/mp4", filename=src.name)


@app.post("/videos/{video_id}/render", status_code=202)
def request_render(video_id: str, req: RenderRequest) -> dict:
    """Dispara o render do trecho escolhido (ou de um highlight) em background."""
    src = _find_input_file(video_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado")
    if _analysis_payload(video_id) is None:
        raise HTTPException(status_code=409, detail="Análise ainda não concluída para este vídeo")
    if req.end_sec <= req.start_sec:
        raise HTTPException(status_code=422, detail="end_sec deve ser maior que start_sec")

    render_id = uuid.uuid4().hex[:12]
    job = _create_job("render", video_id=video_id, render_id=render_id)
    _executor.submit(_run_render, job["job_id"], render_id, video_id, src, req)
    return {"render_id": render_id, "job_id": job["job_id"]}


@app.get("/renders/{render_id}/file")
def get_render_file(render_id: str) -> FileResponse:
    output = RENDERS_DIR / f"{render_id}.mp4"
    if not output.exists():
        raise HTTPException(status_code=404, detail="Render não encontrado (ainda processando?)")
    return FileResponse(output, media_type="video/mp4", filename=f"clip_{render_id}.mp4")


@app.post("/analyze")
def analyze_legacy(video: UploadFile = File(...), whisper_model: str = "base") -> dict:
    """[Legado] Análise síncrona — mantido para compatibilidade.

    Agora persiste o upload em storage (permite render posterior) e inclui
    video_id + highlights na resposta.
    """
    result = upload_video(video=video, whisper_model=whisper_model)
    video_id, job_id = result["video_id"], result["job_id"]

    # Espera o job terminar (comportamento síncrono do endpoint antigo)
    import time

    while True:
        with _jobs_lock:
            job = dict(_jobs[job_id])
        if job["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    if job["status"] == "error":
        raise HTTPException(status_code=422, detail=f"Falha na análise: {job['error']}")

    payload = _analysis_payload(video_id)
    assert payload is not None
    return {
        "video_id": video_id,
        "metadata": payload["metadata"],
        "crop_keyframes": payload["crop_keyframes"],
        "vad_segments": payload["vad_segments"],
        "transcript": payload["transcript"],
        "highlights": payload["highlights"],
    }
