import React from "react";
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { CropKeyframe, CropRect, LayoutMode, TranscriptWord } from "../../../lib/types/analyzer";
import { interpolateCrop } from "../../../lib/store/useTimelineStore";

export interface CropPreviewProps {
  videoUrl: string;
  layoutMode: LayoutMode;
  cropKeyframes: CropKeyframe[];
  splitTop: CropRect | null;
  splitBottom: CropRect | null;
  pipCrop: CropRect | null;
  pipScale: number;
  transcriptWords: TranscriptWord[];
  captionPreset?: string;
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

function FramedCrop({
  videoUrl, rect, sourceWidth, sourceHeight, x, y, width, height, radius = 24,
}: {
  videoUrl: string; rect: CropRect; sourceWidth: number; sourceHeight: number;
  x: number; y: number; width: number; height: number; radius?: number;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, overflow: "hidden", borderRadius: radius, border: "3px solid rgba(255,255,255,0.16)", boxShadow: "0 16px 36px rgba(0,0,0,.36)" }}>
      <CroppedLayer videoUrl={videoUrl} rect={rect} sourceWidth={sourceWidth} sourceHeight={sourceHeight} compW={width} compH={height} />
    </div>
  );
}

// Espelha os presets do backend (app/transform/generate_ass.py).
const CAPTION_PRESETS: Record<string, { highlight: string; mode: "popin" | "karaoke" | "popline" }> = {
  mozi: { highlight: "#fff700", mode: "popin" },
  beasty: { highlight: "#00ff66", mode: "popin" },
  karaoke: { highlight: "#fff700", mode: "karaoke" },
  popline: { highlight: "#00e5ff", mode: "popline" },
};

/** Agrupa palavras em blocos curtos (mesma regra do generate_ass.py). */
function groupCaptionBlocks(words: TranscriptWord[]): TranscriptWord[][] {
  const blocks: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  for (const w of words) {
    if (
      current.length > 0 &&
      (current.length >= 4 ||
        w.endSec - current[0].startSec > 2.5 ||
        w.startSec - current[current.length - 1].endSec > 1.0)
    ) {
      blocks.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function PremiumCaption({ words, tSec, preset = "mozi" }: { words: TranscriptWord[]; tSec: number; preset?: string }) {
  const blocks = React.useMemo(() => groupCaptionBlocks(words), [words]);
  if (preset === "none") return null;
  // Mostra apenas o bloco mais recente iniciado (o render final também nunca
  // deixa dois blocos na tela ao mesmo tempo).
  let block: TranscriptWord[] | null = null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (tSec >= b[0].startSec) {
      if (tSec <= b[b.length - 1].endSec + 0.15) block = b;
      break;
    }
  }
  if (!block) return null;

  const style = CAPTION_PRESETS[preset] ?? CAPTION_PRESETS.mozi;
  // MarginV do render final = 12% da altura → mesma posição aqui (12% de 1920 ≈ 230).
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: 230,
        textAlign: "center",
        fontFamily: "Montserrat, Arial Black, sans-serif",
        fontWeight: 900,
        fontSize: 86,
        lineHeight: 1.1,
        textTransform: "uppercase",
        textShadow: "0 4px 0 #000, 0 8px 18px #000",
        zIndex: 10,
      }}
    >
      {block.map((word) => {
        const spoken = tSec >= word.startSec;
        const active = spoken && tSec <= word.endSec;
        let color = "white";
        let opacity = 1;
        let scale = 1;
        if (style.mode === "popin") {
          opacity = spoken ? 1 : 0; // palavra entra quando falada
          if (active) {
            color = style.highlight;
            scale = 1.12;
          }
        } else if (style.mode === "karaoke") {
          color = active ? style.highlight : spoken ? "white" : "#999";
        } else {
          // popline: tudo visível, ativa ganha cor + pop
          if (active) {
            color = style.highlight;
            scale = 1.12;
          }
        }
        return (
          <span
            key={`${word.startSec}-${word.word}`}
            style={{
              color,
              opacity,
              marginRight: 20,
              display: "inline-block",
              transform: `scale(${scale})`,
            }}
          >
            {word.word}
          </span>
        );
      })}
    </div>
  );
}

export const CompositionCropPreview: React.FC<CropPreviewProps> = ({
  videoUrl,
  layoutMode,
  cropKeyframes,
  splitTop,
  splitBottom,
  pipCrop,
  pipScale,
  transcriptWords,
  captionPreset,
  splitRatio,
  sourceWidth,
  sourceHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: compW, height: compH } = useVideoConfig();
  const tSec = frame / fps;

  if (!videoUrl) return <AbsoluteFill style={{ backgroundColor: "black" }} />;

  const primaryCrop = interpolateCrop(cropKeyframes, tSec) ?? {
    tSec: 0,
    x: Math.round((sourceWidth - sourceHeight * (9 / 16)) / 2),
    y: 0,
    w: Math.round(sourceHeight * (9 / 16)),
    h: sourceHeight,
    confidence: 0,
    source: "center" as const,
  };
  const fullFrame = { x: 0, y: 0, w: sourceWidth, h: sourceHeight };
  const topCrop = splitTop ?? primaryCrop;
  const bottomCrop = splitBottom ?? fullFrame;
  const cameraCrop = pipCrop ?? primaryCrop;

  if (layoutMode === "three-person") {
    const panelW = 310;
    const panelH = 780;
    return (
      <AbsoluteFill style={{ background: "linear-gradient(145deg,#172638,#4f4035)", overflow: "hidden" }}>
        <CroppedLayer videoUrl={videoUrl} rect={fullFrame} sourceWidth={sourceWidth} sourceHeight={sourceHeight} compW={compW} compH={compH} />
        <div style={{ position: "absolute", inset: 0, background: "rgba(9,12,19,.64)" }} />
        <FramedCrop videoUrl={videoUrl} rect={topCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={70} y={560} width={panelW} height={panelH} />
        <FramedCrop videoUrl={videoUrl} rect={primaryCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={385} y={350} width={panelW} height={panelH} />
        <FramedCrop videoUrl={videoUrl} rect={bottomCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={700} y={560} width={panelW} height={panelH} />
        <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
      </AbsoluteFill>
    );
  }

  if (layoutMode === "gameplay") {
    return (
      <AbsoluteFill style={{ background: "#111724" }}>
        <FramedCrop videoUrl={videoUrl} rect={topCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={70} y={70} width={940} height={520} radius={28} />
        <FramedCrop videoUrl={videoUrl} rect={bottomCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={35} y={630} width={1010} height={1210} radius={28} />
        <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
      </AbsoluteFill>
    );
  }

  if (layoutMode === "screenshare") {
    const pipW = Math.round(compW * pipScale);
    const pipH = Math.round(pipW * 1.45);
    return (
      <AbsoluteFill style={{ background: "linear-gradient(145deg,#12171d,#493e2d)" }}>
        <FramedCrop videoUrl={videoUrl} rect={bottomCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={45} y={350} width={990} height={1480} radius={26} />
        <FramedCrop videoUrl={videoUrl} rect={cameraCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} x={70} y={85} width={pipW} height={pipH} radius={22} />
        <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
      </AbsoluteFill>
    );
  }

  // --- FIT: frame inteiro centralizado sobre fundo desfocado ---
  if (layoutMode === "fit") {
    const coverScale = Math.max(compW / sourceWidth, compH / sourceHeight);
    const cropScale = Math.min(compW / primaryCrop.w, compH / primaryCrop.h);
    const cropW = Math.round(primaryCrop.w * cropScale);
    const cropH = Math.round(primaryCrop.h * cropScale);
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
        <div style={{ position: "absolute", left: (compW - cropW) / 2, top: (compH - cropH) / 2, width: cropW, height: cropH, overflow: "hidden", borderRadius: 18, boxShadow: "0 16px 44px rgba(0,0,0,.45)" }}>
          <CroppedLayer videoUrl={videoUrl} rect={primaryCrop} sourceWidth={sourceWidth} sourceHeight={sourceHeight} compW={cropW} compH={cropH} />
        </div>
        <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
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
        <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
      </AbsoluteFill>
    );
  }

  // --- SINGLE: crop 9:16 que segue o sujeito ---
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <CroppedLayer
        videoUrl={videoUrl}
        rect={{ x: primaryCrop.x, y: primaryCrop.y, w: primaryCrop.w, h: primaryCrop.h }}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        compW={compW}
        compH={compH}
      />
      <PremiumCaption words={transcriptWords} tSec={tSec} preset={captionPreset} />
    </AbsoluteFill>
  );
};
