import { create } from "zustand";
import {
  CropKeyframe,
  CropRect,
  DEFAULT_TRANSFORM_CONFIG,
  LayoutMode,
  TransformationConfig,
  TranscriptWord,
  VADSegment,
} from "../types/analyzer";

// Tolerância (s) para considerar um keyframe "no" playhead atual.
const KEYFRAME_SNAP_SEC = 1.0;

// Saída vertical padrão 9:16.
const OUTPUT_W = 1080;
const OUTPUT_H = 1920;

/**
 * Calcula um crop com o aspect da faixa (top/bottom) do layout split, o mais
 * alto possível dentro do frame fonte, centrado em (centerXFrac, centerYFrac).
 */
export function computeSplitCrop(
  sourceW: number,
  sourceH: number,
  fraction: number,
  centerXFrac: number,
  centerYFrac = 0.5,
): CropRect {
  const aspect = OUTPUT_W / (OUTPUT_H * fraction); // largura/altura da faixa de saída
  let h = sourceH;
  let w = Math.round(h * aspect);
  if (w > sourceW) {
    w = sourceW;
    h = Math.round(w / aspect);
  }
  w -= w % 2;
  h -= h % 2;
  const x = Math.max(0, Math.min(Math.round(centerXFrac * sourceW - w / 2), sourceW - w));
  const y = Math.max(0, Math.min(Math.round(centerYFrac * sourceH - h / 2), sourceH - h));
  return { x, y, w, h };
}

/** Crops padrão do split: cima na esquerda, baixo na direita (2 falantes). */
function defaultSplitCrops(sourceW: number, sourceH: number, ratio: number) {
  return {
    top: computeSplitCrop(sourceW, sourceH, ratio, 0.32),
    bottom: computeSplitCrop(sourceW, sourceH, 1 - ratio, 0.68),
  };
}

export interface TimelineState {
  projectId: string | null;
  videoUrl: string | null;
  videoDurationSec: number;
  sourceWidth: number;
  sourceHeight: number;

  playheadSec: number;
  isPlaying: boolean;
  isDraggingCrop: boolean;

  cropKeyframes: CropKeyframe[];
  vadSegments: VADSegment[];
  transcriptWords: TranscriptWord[];
  transformationConfig: TransformationConfig;

  // layout do clipe vertical
  layoutMode: LayoutMode;
  splitRatio: number; // fração da altura para a faixa de cima
  splitTopCrop: CropRect | null;
  splitBottomCrop: CropRect | null;

  // ações
  setPlayhead: (sec: number) => void;
  setPlaying: (playing: boolean) => void;
  setDraggingCrop: (dragging: boolean) => void;
  updateCropKeyframe: (tSec: number, patch: Partial<CropKeyframe>) => void;
  addOrUpdateKeyframeAtPlayhead: (patch: Partial<CropKeyframe>) => void;
  setTransformationConfig: (patch: Partial<TransformationConfig>) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setSplitCrop: (which: "top" | "bottom", patch: Partial<CropRect>) => void;
  setSplitRatioValue: (ratio: number) => void;
  loadAnalysisData: (data: {
    projectId?: string;
    videoUrl: string;
    videoDurationSec: number;
    sourceWidth: number;
    sourceHeight: number;
    cropKeyframes: CropKeyframe[];
    vadSegments: VADSegment[];
    transcriptWords: TranscriptWord[];
  }) => void;
}

/** Keyframe efetivo no tempo `tSec` (interpolação linear entre os vizinhos). */
export function interpolateCrop(keyframes: CropKeyframe[], tSec: number): CropKeyframe | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.tSec - b.tSec);
  if (tSec <= sorted[0].tSec) return sorted[0];
  if (tSec >= sorted[sorted.length - 1].tSec) return sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (tSec >= a.tSec && tSec <= b.tSec) {
      const f = (tSec - a.tSec) / (b.tSec - a.tSec || 1);
      return {
        tSec,
        x: Math.round(a.x + (b.x - a.x) * f),
        y: Math.round(a.y + (b.y - a.y) * f),
        w: Math.round(a.w + (b.w - a.w) * f),
        h: Math.round(a.h + (b.h - a.h) * f),
        confidence: a.confidence + (b.confidence - a.confidence) * f,
        source: f < 0.5 ? a.source : b.source,
      };
    }
  }
  return sorted[0];
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  projectId: null,
  videoUrl: null,
  videoDurationSec: 0,
  sourceWidth: 1920,
  sourceHeight: 1080,

  playheadSec: 0,
  isPlaying: false,
  isDraggingCrop: false,

  cropKeyframes: [],
  vadSegments: [],
  transcriptWords: [],
  transformationConfig: DEFAULT_TRANSFORM_CONFIG,

  layoutMode: "single",
  splitRatio: 0.5,
  splitTopCrop: null,
  splitBottomCrop: null,

  setPlayhead: (sec) =>
    set({ playheadSec: Math.max(0, Math.min(sec, get().videoDurationSec)) }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setDraggingCrop: (dragging) => set({ isDraggingCrop: dragging }),

  setLayoutMode: (mode) =>
    set((state) => {
      if (mode === "split" && (!state.splitTopCrop || !state.splitBottomCrop)) {
        const { top, bottom } = defaultSplitCrops(state.sourceWidth, state.sourceHeight, state.splitRatio);
        return { layoutMode: mode, splitTopCrop: top, splitBottomCrop: bottom };
      }
      return { layoutMode: mode };
    }),

  setSplitCrop: (which, patch) =>
    set((state) => {
      const key = which === "top" ? "splitTopCrop" : "splitBottomCrop";
      const current = state[key];
      if (!current) return {};
      return { [key]: { ...current, ...patch } } as Partial<TimelineState>;
    }),

  setSplitRatioValue: (ratio) =>
    set((state) => {
      // Mudar a divisão altera o aspect de cada faixa: recomputa mantendo o centro.
      const topCx = state.splitTopCrop
        ? (state.splitTopCrop.x + state.splitTopCrop.w / 2) / state.sourceWidth
        : 0.32;
      const bottomCx = state.splitBottomCrop
        ? (state.splitBottomCrop.x + state.splitBottomCrop.w / 2) / state.sourceWidth
        : 0.68;
      return {
        splitRatio: ratio,
        splitTopCrop: computeSplitCrop(state.sourceWidth, state.sourceHeight, ratio, topCx),
        splitBottomCrop: computeSplitCrop(state.sourceWidth, state.sourceHeight, 1 - ratio, bottomCx),
      };
    }),

  updateCropKeyframe: (tSec, patch) =>
    set((state) => ({
      cropKeyframes: state.cropKeyframes.map((k) =>
        Math.abs(k.tSec - tSec) < 1e-6 ? { ...k, ...patch } : k,
      ),
    })),

  addOrUpdateKeyframeAtPlayhead: (patch) =>
    set((state) => {
      const t = state.playheadSec;
      const idx = state.cropKeyframes.findIndex(
        (k) => Math.abs(k.tSec - t) <= KEYFRAME_SNAP_SEC,
      );
      const base = interpolateCrop(state.cropKeyframes, t) ?? {
        tSec: t,
        x: 0,
        y: 0,
        w: state.sourceHeight * (9 / 16),
        h: state.sourceHeight,
        confidence: 1,
        source: "face" as const,
      };
      const next: CropKeyframe = { ...base, ...patch, tSec: t };
      if (idx >= 0) {
        const copy = [...state.cropKeyframes];
        copy[idx] = next;
        return { cropKeyframes: copy };
      }
      return {
        cropKeyframes: [...state.cropKeyframes, next].sort((a, b) => a.tSec - b.tSec),
      };
    }),

  setTransformationConfig: (patch) =>
    set((state) => ({
      transformationConfig: { ...state.transformationConfig, ...patch },
    })),

  loadAnalysisData: (data) =>
    set((state) => {
      const { top, bottom } = defaultSplitCrops(data.sourceWidth, data.sourceHeight, state.splitRatio);
      return {
        projectId: data.projectId ?? null,
        videoUrl: data.videoUrl,
        videoDurationSec: data.videoDurationSec,
        sourceWidth: data.sourceWidth,
        sourceHeight: data.sourceHeight,
        cropKeyframes: data.cropKeyframes,
        vadSegments: data.vadSegments,
        transcriptWords: data.transcriptWords,
        playheadSec: 0,
        // Recalcula os crops split para as dimensões do novo vídeo.
        splitTopCrop: top,
        splitBottomCrop: bottom,
      };
    }),
}));
