"use client";

import { useEffect } from "react";
import { useTimelineStore } from "@/lib/store/useTimelineStore";
import {
  mapCropKeyframes,
  mapTranscriptWords,
  mapVadSegments,
} from "@/lib/mappers/analyzerJsonToState";
import { TimelineEditor } from "@/components/editor/TimelineEditor";

import rawCrop from "@/mocks/mock_crop_keyframes.json";
import rawVad from "@/mocks/mock_vad_segments.json";
import rawTranscript from "@/mocks/mock_transcript.json";

// Duração e vídeo de amostra. Coloque um MP4 em frontend/public/sample_input.mp4
// (mesmo vídeo usado no analyzer). Ajuste a duração conforme o clipe real.
const SAMPLE_VIDEO_URL = "/sample_input.mp4";
const SAMPLE_DURATION_SEC = 10;

export default function EditorPage() {
  const loadAnalysisData = useTimelineStore((s) => s.loadAnalysisData);

  useEffect(() => {
    const crop = mapCropKeyframes(rawCrop);
    loadAnalysisData({
      videoUrl: SAMPLE_VIDEO_URL,
      videoDurationSec: SAMPLE_DURATION_SEC,
      sourceWidth: crop.sourceWidth,
      sourceHeight: crop.sourceHeight,
      cropKeyframes: crop.keyframes,
      vadSegments: mapVadSegments(rawVad),
      transcriptWords: mapTranscriptWords(rawTranscript),
    });
  }, [loadAnalysisData]);

  return <TimelineEditor />;
}
