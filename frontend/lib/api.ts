// Cliente da API do Hydra Creator.

import {
  mapCropKeyframes,
  mapTranscriptWords,
  mapVadSegments,
} from "@/lib/mappers/analyzerJsonToState";
import type { CropKeyframe, TranscriptWord, VADSegment } from "@/lib/types/analyzer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface AnalysisResult {
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
  cropKeyframes: CropKeyframe[];
  vadSegments: VADSegment[];
  transcriptWords: TranscriptWord[];
}

/** Envia o vídeo para o backend, roda a análise e devolve os dados mapeados. */
export async function analyzeVideo(file: File, whisperModel = "base"): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("video", file);

  const res = await fetch(`${API_BASE}/analyze?whisper_model=${encodeURIComponent(whisperModel)}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Análise falhou (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const crop = mapCropKeyframes(data.crop_keyframes);
  return {
    sourceWidth: data.metadata.width,
    sourceHeight: data.metadata.height,
    durationSec: data.metadata.duration_sec,
    cropKeyframes: crop.keyframes,
    vadSegments: mapVadSegments(data.vad_segments),
    transcriptWords: mapTranscriptWords(data.transcript),
  };
}
