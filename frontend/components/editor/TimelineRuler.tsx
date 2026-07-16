"use client";

import React, { useCallback, useRef } from "react";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

interface TimelineRulerProps {
  clipStartSec?: number;
  clipEndSec?: number;
  onClipRangeChange?: (startSec: number, endSec: number) => void;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ clipStartSec, clipEndSec, onClipRangeChange }) => {
  const { videoDurationSec, playheadSec, transcriptWords } = useTimelineStore();
  const setPlayhead = useTimelineStore((state) => state.setPlayhead);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  const seekFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || videoDurationSec <= 0) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPlayhead(fraction * videoDurationSec);
  }, [setPlayhead, videoDurationSec]);

  const tickCount = videoDurationSec > 0 ? Math.min(20, Math.ceil(videoDurationSec)) : 0;
  const playheadPercent = videoDurationSec > 0 ? (playheadSec / videoDurationSec) * 100 : 0;
  const start = Math.max(0, Math.min(clipStartSec ?? 0, videoDurationSec));
  const end = Math.max(start, Math.min(clipEndSec ?? videoDurationSec, videoDurationSec));
  const startPercent = videoDurationSec > 0 ? (start / videoDurationSec) * 100 : 0;
  const endPercent = videoDurationSec > 0 ? (end / videoDurationSec) * 100 : 100;

  const updateHandle = useCallback((clientX: number) => {
    const track = trackRef.current;
    const dragging = draggingRef.current;
    if (!track || !dragging || videoDurationSec <= 0 || !onClipRangeChange) return;
    const rect = track.getBoundingClientRect();
    const value = Math.max(0, Math.min(videoDurationSec, ((clientX - rect.left) / rect.width) * videoDurationSec));
    if (dragging === "start") {
      const next = Math.min(value, end - 0.5);
      onClipRangeChange(next, end);
      setPlayhead(next);
    } else {
      onClipRangeChange(start, Math.max(value, start + 0.5));
    }
  }, [end, onClipRangeChange, setPlayhead, start, videoDurationSec]);

  return (
    <div>
      <div
        ref={trackRef}
        className="timeline-ruler"
        onPointerDown={(event) => seekFromEvent(event.clientX)}
        onPointerMove={(event) => updateHandle(event.clientX)}
        onPointerUp={() => { draggingRef.current = null; }}
        onPointerCancel={() => { draggingRef.current = null; }}
      >
        {tickCount > 0 && Array.from({ length: tickCount + 1 }).map((_, index) => {
          const time = (index / tickCount) * videoDurationSec;
          return <div key={index} className="timeline-tick" style={{ left: `${(index / tickCount) * 100}%` }}><span>{time.toFixed(0)}s</span></div>;
        })}
        {videoDurationSec > 0 && transcriptWords.map((word, index) => (
          <div key={`word-${index}`} className="word-marker" style={{ left: `${(word.startSec / videoDurationSec) * 100}%`, width: `${((word.endSec - word.startSec) / videoDurationSec) * 100}%` }} />
        ))}
        {onClipRangeChange && <>
          <div className="clip-selection-shade before" style={{ width: `${startPercent}%` }} />
          <div className="clip-selection-active" style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }} />
          <div className="clip-selection-shade after" style={{ left: `${endPercent}%`, right: 0 }} />
          <button type="button" className="clip-range-handle start" style={{ left: `${startPercent}%` }} onPointerDown={(event) => { event.stopPropagation(); draggingRef.current = "start"; event.currentTarget.setPointerCapture(event.pointerId); }} aria-label="Arrastar início do corte"><span>IN</span></button>
          <button type="button" className="clip-range-handle end" style={{ left: `${endPercent}%` }} onPointerDown={(event) => { event.stopPropagation(); draggingRef.current = "end"; event.currentTarget.setPointerCapture(event.pointerId); }} aria-label="Arrastar fim do corte"><span>OUT</span></button>
        </>}
        <div className="playhead-line" style={{ left: `${playheadPercent}%` }} />
      </div>
      <div className="playhead-readout"><span>PLAYHEAD <b>{playheadSec.toFixed(2)}s</b></span><span>DURAÇÃO <b>{videoDurationSec.toFixed(1)}s</b></span></div>
    </div>
  );
};
