"use client";

import React, { useCallback, useRef } from "react";
import { CropRect } from "@/lib/types/analyzer";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

interface Props {
  displayWidth: number;
  displayHeight: number;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type Interaction =
  | { mode: "move"; px: number; py: number; rect: CropRect }
  | { mode: "resize"; handle: ResizeHandle; px: number; py: number; rect: CropRect };

const HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

/** Seleções independentes das faixas superior e inferior do modo dividido. */
export const SplitCropOverlay: React.FC<Props> = ({ displayWidth, displayHeight }) => {
  const { splitTopCrop, splitBottomCrop, sourceWidth, sourceHeight } = useTimelineStore();
  const setSplitCrop = useTimelineStore((state) => state.setSplitCrop);
  const setDragging = useTimelineStore((state) => state.setDraggingCrop);
  const scaleX = displayWidth / sourceWidth;
  const scaleY = displayHeight / sourceHeight;

  return (
    <>
      {splitTopCrop && (
        <SplitRect
          rect={splitTopCrop}
          color="#00e5ff"
          label="CIMA"
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
          label="BAIXO"
          scaleX={scaleX}
          scaleY={scaleY}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={(patch) => setSplitCrop("bottom", patch)}
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
      const aspect = initial.w / initial.h;
      const horizontalWidth = initial.w + (handle.includes("e") ? dx : -dx);
      const verticalWidth = (initial.h + (handle.includes("s") ? dy : -dy)) * aspect;
      const proposedWidth = Math.abs(horizontalWidth - initial.w) >= Math.abs(verticalWidth - initial.w)
        ? horizontalWidth
        : verticalWidth;
      const horizontalLimit = handle.includes("e") ? sourceWidth - initial.x : initial.x + initial.w;
      const verticalLimit = (handle.includes("s") ? sourceHeight - initial.y : initial.y + initial.h) * aspect;
      const maxWidth = Math.max(1, Math.min(horizontalLimit, verticalLimit));
      const minWidth = Math.min(Math.max(96, sourceWidth * 0.12), maxWidth);
      const width = Math.max(minWidth, Math.min(proposedWidth, maxWidth));
      const height = width / aspect;

      onChange({
        x: Math.round(handle.includes("w") ? initial.x + initial.w - width : initial.x),
        y: Math.round(handle.includes("n") ? initial.y + initial.h - height : initial.y),
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
