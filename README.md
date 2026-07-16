# Hydra Creator — MVP

SaaS que transforma vídeos horizontais longos em clipes verticais 9:16 com **Motor de Transformação** (anti-fingerprint + valor semântico): micro-zoom dinâmico, color grading, film grain, pitch/speed shift, BGM ducking por VAD e legendas animadas estilo Hormozi.

> **Nota de uso responsável:** as transformações de fingerprint não tornam lícito reutilizar conteúdo de terceiros sem permissão. O valor real está na camada transformativa (legendas, crop inteligente, BGM licenciado, comentário próprio). O Compliance Score existe para educar o usuário nesse sentido.

## Estrutura

```
backend/   Python: analyzer (MediaPipe + Silero VAD + faster-whisper), highlights com score,
           renderizador FFmpeg (crop dinâmico + legendas .ass), API FastAPI com jobs, compliance
frontend/  Next.js 14 + Tailwind + Zustand + Remotion Player: TimelineEditor com preview split-screen
```

## Fluxo da API (v0.2)

```
POST /videos                  upload → análise em background (retorna video_id + job_id)
GET  /jobs/{job_id}           progresso do job (status, fração 0–1, etapa)
GET  /videos/{video_id}       metadados + crop/vad/transcript + highlights com nota 0–100
GET  /videos/{video_id}/file  vídeo original (fonte para o player)
POST /videos/{video_id}/render  render do trecho: {start_sec, end_sec, with_captions, bgm_id…}
GET  /renders/{render_id}/file  download do clipe final 1080x1920 com legendas
```

Uploads e artefatos ficam em `backend/storage/` (`HYDRA_STORAGE_DIR` para mudar).
O frontend (`/editor`) usa esse fluxo: importa o vídeo → mostra os melhores cortes
pontuados pela IA → "Editar clipe" abre o editor já no trecho, ou "Gerar com IA"
entrega o clipe pronto com legendas animadas.

Rodar a API:

```bash
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Render via CLI (sem API):

```bash
python -m app.render.renderer --input video.mp4 --analysis-dir output/analysis \
  --output clip.mp4 --start 12.5 --end 42.0
```

Highlights via CLI:

```bash
python -m app.highlights.highlights --transcript t.json --vad v.json \
  --audio audio.wav --duration 300
```

## Setup — Backend

Requisitos: Python 3.10+, FFmpeg no PATH, GPU NVIDIA + CUDA (opcional — há fallback CPU).

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Validar CUDA (opcional)
python -c "import torch; print(torch.cuda.is_available())"
```

### 1. Rodar o worker de análise

Coloque um vídeo de teste (30–60s recomendado para o primeiro teste) em `app/transform/assets/sample_input.mp4`:

```bash
python -m app.analyzer.analyzer --input app/transform/assets/sample_input.mp4 --output-dir output/analysis
```

Gera `crop_keyframes.json`, `vad_segments.json` e `transcript.json`.

### 2. Rodar a transform chain (FFmpeg)

```bash
bash app/transform/transform_chain.sh \
  app/transform/assets/sample_input.mp4 \
  output/analysis/crop_keyframes.json \
  output/analysis/vad_segments.json \
  output/analysis/transcript.json \
  output/clip_final.mp4 \
  --bgm=app/transform/assets/bgm/sample_bgm.mp3
```

Flags: `--use-cuda=auto|true|false`, `--pitch=1.5`, `--speed=2`, `--grain=0.05`.
Salva também `output/transformation_config_used.json`.

### 3. Compliance score

```bash
python -m app.compliance.compliance \
  --crop output/analysis/crop_keyframes.json \
  --vad output/analysis/vad_segments.json \
  --transcript output/analysis/transcript.json \
  --config output/transformation_config_used.json
```

### Pipeline completo (smoke test)

```bash
python scripts/run_pipeline_demo.py app/transform/assets/sample_input.mp4
```

### Prisma

```bash
cd backend
npx prisma generate --schema prisma/schema.prisma
# com Postgres rodando e DATABASE_URL em .env:
npx prisma db push --schema prisma/schema.prisma
```

## Setup — Frontend

Requisitos: Node 18+.

```bash
cd frontend
npm install
npm run dev
```

Abra `http://localhost:3000/editor`. A página demo carrega os mocks de `frontend/mocks/` (copie os JSONs reais gerados pelo analyzer para lá, e o vídeo de amostra para `frontend/public/sample_input.mp4`).

## Assets necessários (não versionados)

- `backend/app/transform/assets/sample_input.mp4` — vídeo de teste horizontal.
- `backend/app/transform/assets/bgm/sample_bgm.mp3` — trilha livre de direitos (ex.: Uppbeat/Pixabay).
- `frontend/public/sample_input.mp4` — cópia do vídeo de teste para o Remotion Player.
