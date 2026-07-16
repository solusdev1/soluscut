// Cliente da API do Hydra Creator (fluxo assíncrono com jobs).

import {
  mapCropKeyframes,
  mapTranscriptWords,
  mapVadSegments,
} from "@/lib/mappers/analyzerJsonToState";
import type { CropKeyframe, Highlight, TranscriptWord, VADSegment } from "@/lib/types/analyzer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface JobInfo {
  job_id: string;
  kind: "analysis" | "render";
  status: "queued" | "running" | "done" | "error";
  progress: number; // 0–1
  step: string;
  error: string | null;
  video_id?: string;
  render_id?: string;
}

export interface AnalysisResult {
  videoId: string;
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
  cropKeyframes: CropKeyframe[];
  vadSegments: VADSegment[];
  transcriptWords: TranscriptWord[];
  highlights: Highlight[];
}

export type CaptionStyleId = "mozi" | "beasty" | "karaoke" | "popline";
export type RenderLayout = "single" | "fit" | "split";

export interface SplitRenderConfig {
  topCrop: { x: number; y: number; w: number; h: number };
  bottomCrop: { x: number; y: number; w: number; h: number };
  ratio: number;
}

export interface RenderParams {
  startSec: number;
  endSec: number;
  withCaptions?: boolean;
  captionStyle?: CaptionStyleId;
  layout?: RenderLayout;
  split?: SplitRenderConfig | null;
  /** Enquadramento ajustado no editor — sem isso o backend usa o da análise. */
  cropKeyframes?: CropKeyframe[] | null;
  font?: string;
  bgmId?: string | null;
  pitchPercent?: number;
  speedPercent?: number;
}

async function jsonOrThrow(res: Response, context: string) {
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${context} (${res.status}): ${detail}`);
  }
  return res.json();
}

/** Envia o vídeo; a análise roda em background. Retorna ids para polling. */
export async function uploadVideo(
  file: File,
  opts: { whisperModel?: string; minClipSec?: number; maxClipSec?: number } = {},
): Promise<{ videoId: string; jobId: string }> {
  const form = new FormData();
  form.append("video", file);
  form.append("whisper_model", opts.whisperModel ?? "base");
  if (opts.minClipSec != null) form.append("min_clip_sec", String(opts.minClipSec));
  if (opts.maxClipSec != null) form.append("max_clip_sec", String(opts.maxClipSec));

  const data = await jsonOrThrow(
    await fetch(`${API_BASE}/videos`, { method: "POST", body: form }),
    "Upload falhou",
  );
  return { videoId: data.video_id, jobId: data.job_id };
}

export async function getJob(jobId: string): Promise<JobInfo> {
  return jsonOrThrow(await fetch(`${API_BASE}/jobs/${jobId}`), "Job não encontrado");
}

/** Faz polling do job até terminar, reportando progresso. Lança em erro. */
export async function waitForJob(
  jobId: string,
  onProgress?: (progress: number, step: string) => void,
  intervalMs = 1200,
): Promise<JobInfo> {
  for (;;) {
    const job = await getJob(jobId);
    onProgress?.(job.progress, job.step);
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error ?? "Job falhou");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Busca a análise completa (inclui os melhores cortes com pontuação). */
export async function getVideoAnalysis(videoId: string): Promise<AnalysisResult> {
  const data = await jsonOrThrow(
    await fetch(`${API_BASE}/videos/${videoId}`),
    "Falha ao buscar análise",
  );
  if (data.status !== "done") throw new Error("Análise ainda em processamento");

  const crop = mapCropKeyframes(data.crop_keyframes);
  return {
    videoId,
    sourceWidth: data.metadata.width,
    sourceHeight: data.metadata.height,
    durationSec: data.metadata.duration_sec,
    cropKeyframes: crop.keyframes,
    vadSegments: mapVadSegments(data.vad_segments),
    transcriptWords: mapTranscriptWords(data.transcript),
    highlights: (data.highlights as any[]).map((h) => ({
      id: h.id,
      startSec: h.start_sec,
      endSec: h.end_sec,
      durationSec: h.duration_sec,
      score: h.score,
      breakdown: h.breakdown ?? {},
      title: h.title,
      reason: h.reason,
      text: h.text,
    })),
  };
}

/** Dispara o render de um trecho (clipe pronto com legendas). */
export async function requestRender(
  videoId: string,
  params: RenderParams,
): Promise<{ renderId: string; jobId: string }> {
  const data = await jsonOrThrow(
    await fetch(`${API_BASE}/videos/${videoId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_sec: params.startSec,
        end_sec: params.endSec,
        with_captions: params.withCaptions ?? true,
        caption_style: params.captionStyle ?? "mozi",
        layout: params.layout ?? "single",
        split: params.split ?? null,
        crop_keyframes:
          params.cropKeyframes?.map((k) => ({
            t_sec: k.tSec,
            x: Math.round(k.x),
            y: Math.round(k.y),
            w: Math.round(k.w),
            h: Math.round(k.h),
          })) ?? null,
        font: params.font ?? "Montserrat",
        bgm_id: params.bgmId ?? null,
        pitch_percent: params.pitchPercent ?? 0,
        speed_percent: params.speedPercent ?? 0,
      }),
    }),
    "Falha ao iniciar render",
  );
  return { renderId: data.render_id, jobId: data.job_id };
}

export function renderFileUrl(renderId: string): string {
  return `${API_BASE}/renders/${renderId}/file`;
}

export function videoFileUrl(videoId: string): string {
  return `${API_BASE}/videos/${videoId}/file`;
}

/** [Compat] Upload + análise em uma chamada, como o endpoint antigo. */
export async function analyzeVideo(
  file: File,
  whisperModel = "base",
  onProgress?: (progress: number, step: string) => void,
): Promise<AnalysisResult> {
  const { videoId, jobId } = await uploadVideo(file, { whisperModel });
  await waitForJob(jobId, onProgress);
  return getVideoAnalysis(videoId);
}
