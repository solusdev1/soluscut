"use client";

import React, { useCallback, useRef } from "react";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

export const TimelineRuler: React.FC = () => {
  const { videoDurationSec, playheadSec, transcriptWords } = useTimelineStore();
  const setPlayhead = useTimelineStore((state) => state.setPlayhead);
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || videoDurationSec <= 0) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPlayhead(fraction * videoDurationSec);
  }, [setPlayhead, videoDurationSec]);

  const tickCount = videoDurationSec > 0 ? Math.min(20, Math.ceil(videoDurationSec)) : 0;
  const playheadPercent = videoDurationSec > 0 ? (playheadSec / videoDurationSec) * 100 : 0;

  return (
    <div>
      <div ref={trackRef} className="timeline-ruler" onPointerDown={(event) => seekFromEvent(event.clientX)}>
        {tickCount > 0 && Array.from({ length: tickCount + 1 }).map((_, index) => {
          const time = (index / tickCount) * videoDurationSec;
          return <div key={index} className="timeline-tick" style={{ left: `${(index / tickCount) * 100}%` }}><span>{time.toFixed(0)}s</span></div>;
        })}
        {videoDurationSec > 0 && transcriptWords.map((word, index) => (
          <div key={`word-${index}`} className="word-marker" style={{ left: `${(word.startSec / videoDurationSec) * 100}%`, width: `${((word.endSec - word.startSec) / videoDurationSec) * 100}%` }} />
        ))}
        <div className="playhead-line" style={{ left: `${playheadPercent}%` }} />
      </div>
      <div className="playhead-readout"><span>PLAYHEAD <b>{playheadSec.toFixed(2)}s</b></span><span>DURAÇÃO <b>{videoDurationSec.toFixed(1)}s</b></span></div>
    </div>
  );
};
