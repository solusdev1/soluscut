"use client";

import React from "react";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

const FACE_CONFIDENCE_THRESHOLD = 0.6;

export const SafeZoneTrack: React.FC = () => {
  const { vadSegments, cropKeyframes, videoDurationSec } = useTimelineStore();
  if (videoDurationSec <= 0) return null;

  const percent = (seconds: number) => `${(seconds / videoDurationSec) * 100}%`;

  return (
    <div className="safe-tracks">
      <div className="safe-track">
        <span>Fala (VAD)</span>
        <div className="track-rail">
          {vadSegments.filter((segment) => segment.isSpeech).map((segment, index) => (
            <div key={`speech-${index}`} className="speech-segment" style={{ left: percent(segment.startSec), width: percent(segment.endSec - segment.startSec) }} title={`Fala ${segment.startSec.toFixed(1)}–${segment.endSec.toFixed(1)}s`} />
          ))}
        </div>
      </div>
      <div className="safe-track">
        <span>Rosto</span>
        <div className="track-rail">
          {cropKeyframes.filter((keyframe) => keyframe.source === "face" && keyframe.confidence >= FACE_CONFIDENCE_THRESHOLD).map((keyframe, index) => (
            <div key={`face-${index}`} className="face-segment" style={{ left: percent(keyframe.tSec), width: 4 }} title={`Rosto em ${keyframe.tSec.toFixed(1)}s · confiança ${keyframe.confidence.toFixed(2)}`} />
          ))}
        </div>
      </div>
    </div>
  );
};
