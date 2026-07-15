"use client";

import React from "react";
import { LAYOUT_LABELS } from "@/lib/types/analyzer";
import { useTimelineStore } from "@/lib/store/useTimelineStore";
import { SourcePreview, OutputPreview } from "./SplitScreenPreview";
import { SafeZoneTrack } from "./SafeZoneTrack";
import { TimelineRuler } from "./TimelineRuler";
import { VideoUploader } from "./VideoUploader";
import { LayoutPicker } from "./LayoutPicker";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

const steps = [
  { number: "01", label: "Importar vídeo", state: "done" },
  { number: "02", label: "Selecionar corte", state: "done" },
  { number: "03", label: "Composição", state: "active" },
  { number: "04", label: "Legendas", state: "idle" },
  { number: "05", label: "Finalizar", state: "idle" },
];

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="reference-slider">
      <span><em>{label}</em><b>{format(value)}</b></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ background: `linear-gradient(90deg, var(--warm-accent) 0 ${progress}%, #3a404b ${progress}% 100%)` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export const TimelineEditor: React.FC = () => {
  const { videoUrl, videoDurationSec, sourceWidth, sourceHeight, transformationConfig, layoutMode, splitRatio } = useTimelineStore();
  const setConfig = useTimelineStore((state) => state.setTransformationConfig);
  const setSplitRatio = useTimelineStore((state) => state.setSplitRatioValue);

  return (
    <div className="reference-editor-shell">
      <header className="reference-topbar">
        <a href="/" className="reference-brand" aria-label="Hydra Creator — início">
          <span className="reference-brand-mark">H</span>
          <span><strong>Hydra Creator</strong><small>Intelligent Video Studio</small></span>
        </a>
        <nav aria-label="Navegação do produto"><a href="/">Início</a><span>Projetos</span><span>Templates</span><b>Editor</b></nav>
        <div className="reference-top-actions"><span><i /> Salvo</span><VideoUploader /></div>
      </header>

      <main className="reference-workspace">
        <aside className="reference-sidebar">
          <div className="sidebar-project">
            <span>Projeto atual</span>
            <strong>Vídeo vertical</strong>
            <small>{videoUrl ? "Análise concluída" : "Aguardando mídia"}</small>
          </div>

          <div className="step-list" aria-label="Etapas do projeto">
            {steps.map((step) => (
              <div key={step.number} className={`step-item ${step.state}`}>
                <span>{step.state === "done" ? "✓" : step.number}</span>
                <div><strong>{step.label}</strong><small>{step.state === "active" ? "Em edição" : step.state === "done" ? "Concluído" : "Próxima etapa"}</small></div>
              </div>
            ))}
          </div>

          <section className="sidebar-controls">
            <p>Composição</p>
            <LayoutPicker />
            {layoutMode === "split" && <Slider label="Divisão" value={splitRatio} min={0.3} max={0.7} step={0.05} format={(value) => `${Math.round(value * 100)} / ${Math.round((1 - value) * 100)}`} onChange={setSplitRatio} />}
          </section>

          <section className="sidebar-controls">
            <p>Transformação</p>
            <div className="reference-control-stack">
              <Slider label="Zoom" value={transformationConfig.zoomMaxScale} min={1} max={1.3} step={0.01} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => setConfig({ zoomMaxScale: value })} />
              <Slider label="Velocidade" value={transformationConfig.speedPercent} min={0} max={4} step={0.1} format={(value) => `${value.toFixed(1)}%`} onChange={(value) => setConfig({ speedPercent: value })} />
              <Slider label="Textura" value={transformationConfig.grainOpacity} min={0} max={0.1} step={0.005} format={(value) => `${(value * 100).toFixed(1)}%`} onChange={(value) => setConfig({ grainOpacity: value })} />
            </div>
          </section>
        </aside>

        <div className="reference-main-column">
          <section className="reference-panel source-stage-panel">
            <div className="reference-panel-header">
              <div><span>Vídeo original</span><strong>Arraste para mover e use os cantos para redimensionar</strong></div>
              <div className="reference-tags"><b>{sourceWidth} × {sourceHeight}</b><b>{formatDuration(videoDurationSec)}</b></div>
            </div>
            <div className="source-stage"><SourcePreview /></div>
          </section>

          <section className="reference-panel editing-panel">
            <div className="reference-panel-header">
              <div><span>Reenquadramento e corte</span><strong>Ajuste o ritmo e preserve as zonas importantes</strong></div>
              <b className="mode-pill">{LAYOUT_LABELS[layoutMode]}</b>
            </div>
            <div className="editing-body">
              <div className="cut-summary">
                <div><span>INÍCIO</span><strong>0.00</strong><small>segundos</small></div>
                <i>→</i>
                <div><span>FIM</span><strong>{videoDurationSec.toFixed(2)}</strong><small>segundos</small></div>
                <div className="duration-summary"><span>DURAÇÃO FINAL</span><strong>{formatDuration(videoDurationSec)}</strong></div>
              </div>
              <TimelineRuler />
              <SafeZoneTrack />
            </div>
          </section>
        </div>

        <aside className="reference-preview-column">
          <div className="preview-column-heading"><span>Prévia 9:16</span><b>1080 × 1920</b></div>
          <OutputPreview />
          <div className="preview-specs">
            <div><span>Formato</span><strong>Vertical 9:16</strong></div>
            <div><span>Qualidade</span><strong>Full HD · 30 fps</strong></div>
            <div><span>Status</span><strong className="ready-status"><i /> Pronto</strong></div>
          </div>
          <div className="preview-note"><span>✦</span><p>O enquadramento respeita as zonas de fala e os rostos detectados.</p></div>
        </aside>
      </main>
    </div>
  );
};

export default TimelineEditor;
