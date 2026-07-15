"use client";

import React, { useRef, useState } from "react";
import { analyzeVideo } from "@/lib/api";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

export const VideoUploader: React.FC = () => {
  const loadAnalysisData = useTimelineStore((state) => state.loadAnalysisData);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setStatus("analyzing");

    const objectUrl = URL.createObjectURL(file);
    try {
      const analysis = await analyzeVideo(file);
      loadAnalysisData({
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
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setStatus("error");
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
