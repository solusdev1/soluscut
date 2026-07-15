// Converte os JSONs snake_case do analyzer.py para os tipos camelCase do frontend.

import type {
  CropKeyframe,
  CropKeyframesData,
  TranscriptWord,
  VADSegment,
} from "@/lib/types/analyzer";

interface RawCropKeyframe {
  t_sec: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  source: string;
}

export function mapCropKeyframes(raw: {
  video_id: string;
  source_width: number;
  source_height: number;
  keyframes: RawCropKeyframe[];
}): CropKeyframesData {
  return {
    videoId: raw.video_id,
    sourceWidth: raw.source_width,
    sourceHeight: raw.source_height,
    keyframes: raw.keyframes.map((k) => ({
      tSec: k.t_sec,
      x: k.x,
      y: k.y,
      w: k.w,
      h: k.h,
      confidence: k.confidence,
      source: (k.source === "face" || k.source === "gameplay" ? k.source : "center") as CropKeyframe["source"],
    })),
  };
}

export function mapVadSegments(raw: {
  segments: { start_sec: number; end_sec: number; is_speech: boolean }[];
}): VADSegment[] {
  return raw.segments.map((s) => ({
    startSec: s.start_sec,
    endSec: s.end_sec,
    isSpeech: s.is_speech,
  }));
}

export function mapTranscriptWords(raw: {
  words: { word: string; start_sec: number; end_sec: number; confidence: number }[];
}): TranscriptWord[] {
  return raw.words.map((w) => ({
    word: w.word,
    startSec: w.start_sec,
    endSec: w.end_sec,
    confidence: w.confidence,
  }));
}
