"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useTimelineStore } from "@/lib/store/useTimelineStore";
import { CompositionCropPreview } from "./remotion/CompositionCropPreview";
import { CropOverlay } from "./CropOverlay";
import { SplitCropOverlay } from "./SplitCropOverlay";

function useCompositionProps() {
  const state = useTimelineStore();
  const inputProps = useMemo(
    () => ({
      videoUrl: state.videoUrl ?? "",
      layoutMode: state.layoutMode,
      cropKeyframes: state.cropKeyframes,
      splitTop: state.splitTopCrop,
      splitBottom: state.splitBottomCrop,
      pipCrop: state.pipCrop,
      pipScale: state.pipScale,
      splitRatio: state.splitRatio,
      sourceWidth: state.sourceWidth,
      sourceHeight: state.sourceHeight,
      transcriptWords: state.transcriptWords,
      captionPreset: state.captionPreset,
    }),
    [state.videoUrl, state.layoutMode, state.cropKeyframes, state.splitTopCrop, state.splitBottomCrop, state.pipCrop, state.pipScale, state.splitRatio, state.sourceWidth, state.sourceHeight, state.transcriptWords, state.captionPreset],
  );

  return { state, inputProps };
}

export const SourcePreview: React.FC = () => {
  const { state } = useCompositionProps();
  const setPlayhead = useTimelineStore((item) => item.setPlayhead);
  const setPlaying = useTimelineStore((item) => item.setPlaying);
  const sourceFrameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [displayWidth, setDisplayWidth] = useState(720);

  useEffect(() => {
    const frame = sourceFrameRef.current;
    if (!frame) return;
    const syncSize = () => setDisplayWidth(Math.max(1, Math.round(frame.getBoundingClientRect().width)));
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || state.isPlaying) return;
    if (Math.abs(video.currentTime - state.playheadSec) > 0.08) {
      video.currentTime = state.playheadSec;
    }
  }, [state.isPlaying, state.playheadSec]);

  const aspect = state.sourceWidth > 0 ? state.sourceHeight / state.sourceWidth : 9 / 16;
  const displayHeight = displayWidth * aspect;

  return (
    <div ref={sourceFrameRef} className="reference-video-shell" style={{ aspectRatio: `${state.sourceWidth} / ${state.sourceHeight}` }}>
      {state.videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={state.videoUrl}
            className="h-full w-full object-contain"
            onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            controls
          />
          {state.layoutMode !== "split" && state.layoutMode !== "screenshare" && <CropOverlay displayWidth={displayWidth} displayHeight={displayHeight} label={state.layoutMode === "three-person" ? "PESSOA 2" : "9:16 · AJUSTÁVEL"} />}
          {(state.layoutMode === "split" || state.layoutMode === "three-person" || state.layoutMode === "gameplay" || state.layoutMode === "screenshare") && <SplitCropOverlay displayWidth={displayWidth} displayHeight={displayHeight} />}
        </>
      ) : (
        <div className="empty-preview h-full">Carregue um vídeo para começar</div>
      )}
    </div>
  );
};

export const OutputPreview: React.FC = () => {
  const { state, inputProps } = useCompositionProps();
  const durationInFrames = Math.max(1, Math.round(state.videoDurationSec * 30));
  const playerRef = useRef<PlayerRef>(null);

  // Segue o playhead quando pausado — abrir um highlight posiciona o preview no trecho.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || state.isPlaying) return;
    const targetFrame = Math.round(state.playheadSec * 30);
    if (Math.abs(player.getCurrentFrame() - targetFrame) > 2) {
      player.seekTo(targetFrame);
    }
  }, [state.playheadSec, state.isPlaying]);

  return (
    <div className="reference-output-shell">
      {state.videoUrl ? (
        <Player
          ref={playerRef}
          component={CompositionCropPreview}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          fps={30}
          compositionWidth={1080}
          compositionHeight={1920}
          style={{ width: "100%" }}
          controls
          loop
        />
      ) : (
        <div className="empty-preview" style={{ aspectRatio: "9 / 16" }}>Sem preview</div>
      )}
    </div>
  );
};

export const SplitScreenPreview: React.FC = () => (
  <div className="preview-grid">
    <div className="preview-pane"><div className="preview-meta"><span>Fonte original</span></div><SourcePreview /></div>
    <div className="preview-pane output-preview"><div className="preview-meta"><span>Resultado</span></div><OutputPreview /></div>
  </div>
);
