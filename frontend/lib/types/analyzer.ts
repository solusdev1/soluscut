// Tipos camelCase espelhando os JSONs do analyzer.py (snake_case).
// A conversão acontece em lib/mappers/analyzerJsonToState.ts.

export type CropSource = "face" | "gameplay" | "center";

/**
 * Layout do clipe vertical 9:16:
 *  - "single": crop único que segue o sujeito (preenche a tela).
 *  - "split":  tela dividida cima/baixo (duas pessoas / dois enquadramentos).
 *  - "fit":    frame inteiro centralizado com fundo desfocado (sem cortar nada).
 */
export type LayoutMode = "single" | "split" | "fit";

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  single: "Preencher",
  split: "Tela dividida",
  fit: "Ajustar + fundo",
};

/** Retângulo de crop em coordenadas do vídeo fonte (px). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropKeyframe {
  tSec: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  source: CropSource;
}

export interface CropKeyframesData {
  videoId: string;
  sourceWidth: number;
  sourceHeight: number;
  keyframes: CropKeyframe[];
}

export interface VADSegment {
  startSec: number;
  endSec: number;
  isSpeech: boolean;
}

export interface TranscriptWord {
  word: string;
  startSec: number;
  endSec: number;
  confidence: number;
}

export interface ColorGradeParams {
  contrast: number;
  saturation: number;
  gamma: number;
  temperature?: number;
}

export interface CaptionStyle {
  fontFamily: string;
  highlightColor: string;
  popInScale: number;
  keywordHighlight: boolean;
}

export interface TransformationConfig {
  zoomMinScale: number;
  zoomMaxScale: number;
  pitchShiftPercent: number;
  speedPercent: number;
  grainOpacity: number;
  bgmDuckSpeechLevel: number;
  bgmDuckSilenceLevel: number;
  colorGradeParams: ColorGradeParams;
  captionStyle: CaptionStyle;
}

export const DEFAULT_TRANSFORM_CONFIG: TransformationConfig = {
  zoomMinScale: 1.0,
  zoomMaxScale: 1.15,
  pitchShiftPercent: 1.5,
  speedPercent: 2.0,
  grainOpacity: 0.05,
  bgmDuckSpeechLevel: 0.15,
  bgmDuckSilenceLevel: 0.8,
  colorGradeParams: { contrast: 1.05, saturation: 1.05, gamma: 0.98 },
  captionStyle: {
    fontFamily: "Montserrat",
    highlightColor: "#FFF700",
    popInScale: 1.2,
    keywordHighlight: true,
  },
};
