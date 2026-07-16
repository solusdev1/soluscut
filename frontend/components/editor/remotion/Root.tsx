import React from "react";
import { Composition } from "remotion";
import { CompositionCropPreview } from "./CompositionCropPreview";

// Registro de composições para o Remotion Studio (`npx remotion studio`).
// O preview embutido no editor usa <Player> diretamente (SplitScreenPreview.tsx),
// então este Root serve para render/preview standalone via CLI.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CropPreview"
      component={CompositionCropPreview}
      durationInFrames={30 * 30}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoUrl: "",
        layoutMode: "single" as const,
        cropKeyframes: [],
        splitTop: null,
        splitBottom: null,
        pipCrop: null,
        pipScale: 0.28,
        transcriptWords: [],
        splitRatio: 0.5,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }}
    />
  );
};
