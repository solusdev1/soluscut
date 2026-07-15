"use client";

import React from "react";
import { LAYOUT_LABELS, LayoutMode } from "@/lib/types/analyzer";
import { useTimelineStore } from "@/lib/store/useTimelineStore";

const ORDER: LayoutMode[] = ["single", "split", "fit"];

export const LayoutPicker: React.FC = () => {
  const layoutMode = useTimelineStore((state) => state.layoutMode);
  const setLayoutMode = useTimelineStore((state) => state.setLayoutMode);

  return (
    <div className="layout-picker">
      {ORDER.map((mode) => {
        const active = layoutMode === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => setLayoutMode(mode)}
            className={`layout-option ${active ? "active" : ""}`}
          >
            <span className={`layout-thumb ${mode}`} aria-hidden="true" />
            <span>{LAYOUT_LABELS[mode]}</span>
          </button>
        );
      })}
    </div>
  );
};
