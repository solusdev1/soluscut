"use client";

import React, { useCallback, useRef } from "react";
import { interpolateCrop, useTimelineStore } from "@/lib/store/useTimelineStore";

interface CropOverlayProps {
  displayWidth: number;
  displayHeight: number;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type CropGeometry = { x: number; y: number; w: number; h: number };
type Interaction =
  | { mode: "move"; startX: number; startY: number; rect: CropGeometry }
  | { mode: "resize"; handle: ResizeHandle; startX: number; startY: number; rect: CropGeometry };

const HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

/**
 * Janela de corte do layout vertical. O interior move a seleção em X/Y e os
 * cantos redimensionam mantendo a proporção atual. Cada alteração é gravada
 * como keyframe no ponto atual da timeline.
 */
export const CropOverlay: React.FC<CropOverlayProps> = ({ displayWidth, displayHeight }) => {
  const { cropKeyframes, playheadSec, sourceWidth, sourceHeight } = useTimelineStore();
  const addOrUpdate = useTimelineStore((state) => state.addOrUpdateKeyframeAtPlayhead);
  const setDragging = useTimelineStore((state) => state.setDraggingCrop);
  const interaction = useRef<Interaction | null>(null);

  const crop = interpolateCrop(cropKeyframes, playheadSec);
  const scaleX = displayWidth / sourceWidth;
  const scaleY = displayHeight / sourceHeight;

  const beginMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!crop) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = {
        mode: "move",
        startX: event.clientX,
        startY: event.clientY,
        rect: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
      };
      setDragging(true);
    },
    [crop, setDragging],
  );

  const beginResize = useCallback(
    (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => {
      if (!crop) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = {
        mode: "resize",
        handle,
        startX: event.clientX,
        startY: event.clientY,
        rect: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
      };
      setDragging(true);
    },
    [crop, setDragging],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const active = interaction.current;
      if (!active) return;

      const dx = (event.clientX - active.startX) / scaleX;
      const dy = (event.clientY - active.startY) / scaleY;

      if (active.mode === "move") {
        const x = Math.max(0, Math.min(active.rect.x + dx, sourceWidth - active.rect.w));
        const y = Math.max(0, Math.min(active.rect.y + dy, sourceHeight - active.rect.h));
        addOrUpdate({ x: Math.round(x), y: Math.round(y), source: "face" });
        return;
      }

      const { handle, rect } = active;
      const aspect = rect.w / rect.h;
      const horizontalWidth = rect.w + (handle.includes("e") ? dx : -dx);
      const verticalWidth = (rect.h + (handle.includes("s") ? dy : -dy)) * aspect;
      const proposedWidth = Math.abs(horizontalWidth - rect.w) >= Math.abs(verticalWidth - rect.w)
        ? horizontalWidth
        : verticalWidth;

      const horizontalLimit = handle.includes("e") ? sourceWidth - rect.x : rect.x + rect.w;
      const verticalLimit = (handle.includes("s") ? sourceHeight - rect.y : rect.y + rect.h) * aspect;
      const maxWidth = Math.max(1, Math.min(horizontalLimit, verticalLimit));
      const minWidth = Math.min(Math.max(96, sourceWidth * 0.12), maxWidth);
      const width = Math.max(minWidth, Math.min(proposedWidth, maxWidth));
      const height = width / aspect;
      const x = handle.includes("w") ? rect.x + rect.w - width : rect.x;
      const y = handle.includes("n") ? rect.y + rect.h - height : rect.y;

      addOrUpdate({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(width),
        h: Math.round(height),
        source: "face",
      });
    },
    [addOrUpdate, scaleX, scaleY, sourceHeight, sourceWidth],
  );

  const endInteraction = useCallback(() => {
    interaction.current = null;
    setDragging(false);
  }, [setDragging]);

  if (!crop) return null;

  const borderColor = crop.source === "face" ? "#f59e0b" : crop.source === "gameplay" ? "#00e5ff" : "#94a3b8";

  return (
    <div
      className="adjustable-crop"
      onPointerDown={beginMove}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      style={{
        position: "absolute",
        left: crop.x * scaleX,
        top: crop.y * scaleY,
        width: crop.w * scaleX,
        height: crop.h * scaleY,
        border: `2px solid ${borderColor}`,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
        cursor: "move",
        touchAction: "none",
      }}
      title={`Corte vertical em ${playheadSec.toFixed(2)}s — arraste para mover`}
    >
      <span className="crop-overlay-label" style={{ color: borderColor }}>9:16 · AJUSTÁVEL</span>
      <span className="crop-move-hint">Arraste para mover</span>
      {HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          className={`crop-resize-handle crop-resize-${handle}`}
          style={{ backgroundColor: borderColor }}
          onPointerDown={(event) => beginResize(handle, event)}
          aria-label={`Redimensionar pelo canto ${handle}`}
        />
      ))}
    </div>
  );
};
