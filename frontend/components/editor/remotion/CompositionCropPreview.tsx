import React from "react";
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { CropKeyframe, CropRect, LayoutMode } from "../../../lib/types/analyzer";
import { interpolateCrop } from "../../../lib/store/useTimelineStore";

export interface CropPreviewProps {
  videoUrl: string;
  layoutMode: LayoutMode;
  cropKeyframes: CropKeyframe[];
  splitTop: CropRect | null;
  splitBottom: CropRect | null;
  splitRatio: number;
  sourceWidth: number;
  sourceHeight: number;
  [key: string]: unknown; // exigido pelo tipo de props do Remotion
}

/** Renderiza o vídeo fonte recortado por `rect` preenchendo um box compW x compH. */
function CroppedLayer({
  videoUrl,
  rect,
  sourceWidth,
  sourceHeight,
  compW,
  compH,
}: {
  videoUrl: string;
  rect: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  compW: number;
  compH: number;
}) {
  // Escala para o crop preencher o box (cover), depois desloca para a origem do crop.
  const scale = Math.max(compW / rect.w, compH / rect.h);
  const translateX = -rect.x * scale;
  const translateY = -rect.y * scale;
  return (
    <div style={{ position: "absolute", width: compW, height: compH, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: sourceWidth * scale,
          height: sourceHeight * scale,
          transform: `translate(${translateX}px, ${translateY}px)`,
        }}
      >
        <OffthreadVideo src={videoUrl} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

export const CompositionCropPreview: React.FC<CropPreviewProps> = ({
  videoUrl,
  layoutMode,
  cropKeyframes,
  splitTop,
  splitBottom,
  splitRatio,
  sourceWidth,
  sourceHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: compW, height: compH } = useVideoConfig();
  const tSec = frame / fps;

  if (!videoUrl) return <AbsoluteFill style={{ backgroundColor: "black" }} />;

  // --- FIT: frame inteiro centralizado sobre fundo desfocado ---
  if (layoutMode === "fit") {
    const coverScale = Math.max(compW / sourceWidth, compH / sourceHeight);
    const containScale = Math.min(compW / sourceWidth, compH / sourceHeight);
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            width: sourceWidth * coverScale,
            height: sourceHeight * coverScale,
            left: (compW - sourceWidth * coverScale) / 2,
            top: (compH - sourceHeight * coverScale) / 2,
            filter: "blur(24px) brightness(0.6)",
          }}
        >
          <OffthreadVideo src={videoUrl} style={{ width: "100%", height: "100%" }} muted />
        </div>
        <div
          style={{
            position: "absolute",
            width: sourceWidth * containScale,
            height: sourceHeight * containScale,
            left: (compW - sourceWidth * containScale) / 2,
            top: (compH - sourceHeight * containScale) / 2,
          }}
        >
          <OffthreadVideo src={videoUrl} style={{ width: "100%", height: "100%" }} />
        </div>
      </AbsoluteFill>
    );
  }

  // --- SPLIT: duas faixas empilhadas ---
  if (layoutMode === "split" && splitTop && splitBottom) {
    const topH = Math.round(compH * splitRatio);
    const bottomH = compH - topH;
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: compW, height: topH, overflow: "hidden" }}>
          <CroppedLayer videoUrl={videoUrl} rect={splitTop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} compW={compW} compH={topH} />
        </div>
        <div style={{ position: "absolute", top: topH, left: 0, width: compW, height: bottomH, overflow: "hidden" }}>
          <CroppedLayer videoUrl={videoUrl} rect={splitBottom} sourceWidth={sourceWidth} sourceHeight={sourceHeight} compW={compW} compH={bottomH} />
        </div>
        {/* linha divisória sutil */}
        <div style={{ position: "absolute", top: topH - 1, left: 0, width: compW, height: 2, background: "rgba(0,0,0,0.6)" }} />
      </AbsoluteFill>
    );
  }

  // --- SINGLE: crop 9:16 que segue o sujeito ---
  const crop =
    interpolateCrop(cropKeyframes, tSec) ?? {
      tSec: 0,
      x: Math.round((sourceWidth - sourceHeight * (9 / 16)) / 2),
      y: 0,
      w: Math.round(sourceHeight * (9 / 16)),
      h: sourceHeight,
      confidence: 0,
      source: "center" as const,
    };

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <CroppedLayer
        videoUrl={videoUrl}
        rect={{ x: crop.x, y: crop.y, w: crop.w, h: crop.h }}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        compW={compW}
        compH={compH}
      />
    </AbsoluteFill>
  );
};
