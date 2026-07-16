"use client";

import React, { useRef, useState } from "react";
import { analyzeVideo } from "@/lib/api";
import {
  mapCropKeyframes,
  mapTranscriptWords,
  mapVadSegments,
} from "@/lib/mappers/analyzerJsonToState";
import { useTimelineStore } from "@/lib/store/useTimelineStore";
import rawCrop from "@/mocks/mock_crop_keyframes.json";
import rawVad from "@/mocks/mock_vad_segments.json";
import rawTranscript from "@/mocks/mock_transcript.json";
import { setRenderSource } from "@/lib/renderSource";

export const VideoUploader: React.FC = () => {
  const loadAnalysisData = useTimelineStore((state) => state.loadAnalysisData);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const loadDemoAnalysis = (videoUrl: string, durationSec: number) => {
    const crop = mapCropKeyframes(rawCrop);
    loadAnalysisData({
      videoUrl,
      videoDurationSec: Math.max(1, durationSec || 10),
      sourceWidth: crop.sourceWidth,
      sourceHeight: crop.sourceHeight,
      cropKeyframes: crop.keyframes,
      vadSegments: mapVadSegments(rawVad),
      transcriptWords: mapTranscriptWords(rawTranscript),
    });
  };

  const onSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRenderSource(file);
    setFileName(file.name);
    setError(null);
    setStatus("analyzing");

    const objectUrl = URL.createObjectURL(file);
    try {
      const analysis = await analyzeVideo(file);
      loadAnalysisData({
        videoId: analysis.videoId,
        videoUrl: objectUrl,
        videoDurationSec: analysis.durationSec,
        sourceWidth: analysis.sourceWidth,
        sourceHeight: analysis.sourceHeight,
        cropKeyframes: analysis.cropKeyframes,
        vadSegments: analysis.vadSegments,
        transcriptWords: analysis.transcriptWords,
      });
      setStatus("idle");
    } catch (caughtError) {
      // Permite testar o editor sem instalar o worker de análise local.
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        loadDemoAnalysis(objectUrl, video.duration);
        setError("Análise local indisponível — usando dados de demonstração.");
        setStatus("idle");
      };
      video.onerror = () => {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        setStatus("error");
      };
      video.src = objectUrl;
    }
  };

  return (
    <div className="upload-wrap">
      {status === "analyzing" && <span className="upload-status">Analisando {fileName}…</span>}
      {status === "error" && <span className="upload-status error">{error}</span>}
      {status === "idle" && fileName && <span className="upload-status success">✓ {fileName}</span>}
      <button type="button" className="upload-button" onClick={() => inputRef.current?.click()} disabled={status === "analyzing"}>
        {status === "analyzing" ? "Processando…" : "+ Novo vídeo"}
      </button>
      <input ref={inputRef} type="file" accept="video/*" onChange={onSelect} className="hidden" aria-label="Selecionar novo vídeo" />
    </div>
  );
};
