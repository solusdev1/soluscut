"use client";

import React, { useCallback, useRef } from "react";
import { CropRect } from "@/lib/types/analyzer";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

interface Props {
  displayWidth: number;
  displayHeight: number;
}

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Interaction =
  | { mode: "move"; px: number; py: number; rect: CropRect }
  | { mode: "resize"; handle: ResizeHandle; px: number; py: number; rect: CropRect };

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Seleções independentes das faixas superior e inferior do modo dividido. */
export const SplitCropOverlay: React.FC<Props> = ({ displayWidth, displayHeight }) => {
  const { splitTopCrop, splitBottomCrop, pipCrop, sourceWidth, sourceHeight, layoutMode } = useTimelineStore();
  const setSplitCrop = useTimelineStore((state) => state.setSplitCrop);
  const setPipCrop = useTimelineStore((state) => state.setPipCrop);
  const setDragging = useTimelineStore((state) => state.setDraggingCrop);
  const scaleX = displayWidth / sourceWidth;
  const scaleY = displayHeight / sourceHeight;

  return (
    <>
      {splitTopCrop && (
        <SplitRect
          rect={splitTopCrop}
          color="#00e5ff"
          label={layoutMode === "gameplay" ? "CÂMERA" : layoutMode === "screenshare" ? "TELA" : layoutMode === "three-person" ? "PESSOA 1" : "CIMA"}
          scaleX={scaleX}
          scaleY={scaleY}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={(patch) => setSplitCrop("top", patch)}
          onDragState={setDragging}
        />
      )}
      {splitBottomCrop && (
        <SplitRect
          rect={splitBottomCrop}
          color="#f59e0b"
          label={layoutMode === "gameplay" ? "GAMEPLAY" : layoutMode === "screenshare" ? "TELA PRINCIPAL" : layoutMode === "three-person" ? "PESSOA 3" : "BAIXO"}
          scaleX={scaleX}
          scaleY={scaleY}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={(patch) => setSplitCrop("bottom", patch)}
          onDragState={setDragging}
        />
      )}
      {layoutMode === "screenshare" && pipCrop && (
        <SplitRect
          rect={pipCrop}
          color="#f59e0b"
          label="CÂMERA PEQUENA"
          scaleX={scaleX}
          scaleY={scaleY}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={setPipCrop}
          onDragState={setDragging}
        />
      )}
    </>
  );
};

function SplitRect({
  rect,
  color,
  label,
  scaleX,
  scaleY,
  sourceWidth,
  sourceHeight,
  onChange,
  onDragState,
}: {
  rect: CropRect;
  color: string;
  label: string;
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  onChange: (patch: Partial<CropRect>) => void;
  onDragState: (dragging: boolean) => void;
}) {
  const interaction = useRef<Interaction | null>(null);

  const beginMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { mode: "move", px: event.clientX, py: event.clientY, rect: { ...rect } };
      onDragState(true);
    },
    [onDragState, rect],
  );

  const beginResize = useCallback(
    (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { mode: "resize", handle, px: event.clientX, py: event.clientY, rect: { ...rect } };
      onDragState(true);
    },
    [onDragState, rect],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const active = interaction.current;
      if (!active) return;
      const dx = (event.clientX - active.px) / scaleX;
      const dy = (event.clientY - active.py) / scaleY;

      if (active.mode === "move") {
        const x = Math.max(0, Math.min(active.rect.x + dx, sourceWidth - active.rect.w));
        const y = Math.max(0, Math.min(active.rect.y + dy, sourceHeight - active.rect.h));
        onChange({ x: Math.round(x), y: Math.round(y) });
        return;
      }

      const { handle, rect: initial } = active;
      const minWidth = Math.min(Math.max(96, sourceWidth * 0.08), sourceWidth);
      const minHeight = Math.min(Math.max(96, sourceHeight * 0.08), sourceHeight);
      let width = initial.w;
      let height = initial.h;
      let x = initial.x;
      let y = initial.y;
      if (handle.includes("e")) width = Math.max(minWidth, Math.min(initial.w + dx, sourceWidth - initial.x));
      if (handle.includes("w")) { width = Math.max(minWidth, Math.min(initial.w - dx, initial.x + initial.w)); x = initial.x + initial.w - width; }
      if (handle.includes("s")) height = Math.max(minHeight, Math.min(initial.h + dy, sourceHeight - initial.y));
      if (handle.includes("n")) { height = Math.max(minHeight, Math.min(initial.h - dy, initial.y + initial.h)); y = initial.y + initial.h - height; }

      onChange({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(width),
        h: Math.round(height),
      });
    },
    [onChange, scaleX, scaleY, sourceHeight, sourceWidth],
  );

  const endInteraction = useCallback(() => {
    interaction.current = null;
    onDragState(false);
  }, [onDragState]);

  return (
    <div
      className="adjustable-crop split-adjustable-crop"
      onPointerDown={beginMove}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      style={{
        position: "absolute",
        left: rect.x * scaleX,
        top: rect.y * scaleY,
        width: rect.w * scaleX,
        height: rect.h * scaleY,
        border: `2px solid ${color}`,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.42)",
        cursor: "move",
        touchAction: "none",
      }}
      title={`${label}: arraste para mover ou use os cantos para redimensionar`}
    >
      <span className="crop-overlay-label split-crop-label" style={{ color }}>{label}</span>
      <span className="crop-move-hint">Mover</span>
      {HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          className={`crop-resize-handle crop-resize-${handle}`}
          style={{ backgroundColor: color }}
          onPointerDown={(event) => beginResize(handle, event)}
          aria-label={`Redimensionar ${label.toLowerCase()} pelo canto ${handle}`}
        />
      ))}
    </div>
  );
}
