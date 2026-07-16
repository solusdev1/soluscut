"use client";

import React, { useEffect, useState } from "react";
import { LAYOUT_LABELS } from "@/lib/types/analyzer";
import { interpolateCrop, useTimelineStore } from "@/lib/store/useTimelineStore";
import { renderFileUrl, requestRender, waitForJob, type CaptionStyleId, type RenderLayout, type SplitRenderConfig } from "@/lib/api";
import { SourcePreview, OutputPreview } from "./SplitScreenPreview";
import { SafeZoneTrack } from "./SafeZoneTrack";
import { TimelineRuler } from "./TimelineRuler";
import { VideoUploader } from "./VideoUploader";
import { LayoutPicker } from "./LayoutPicker";
import { getRenderSource } from "@/lib/renderSource";

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

// Presets de legenda (mesmos do backend generate_ass.py) com rótulos de exibição.
const CAPTION_PRESET_OPTIONS: { id: CaptionStyleId; label: string; hint: string }[] = [
  { id: "mozi", label: "Mozi", hint: "Palavra em amarelo" },
  { id: "beasty", label: "Beasty", hint: "Destaque verde neon" },
  { id: "karaoke", label: "Karaokê", hint: "Acompanha a fala" },
  { id: "popline", label: "Popline", hint: "Pop em ciano" },
];

export const TimelineEditor: React.FC = () => {
  const [captionStage, setCaptionStage] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [cutPoints, setCutPoints] = useState<number[]>([]);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(30);
  const [renderState, setRenderState] = useState<{ status: "idle" | "rendering" | "error"; progress: number; error?: string }>({ status: "idle", progress: 0 });
  const { videoId, videoUrl, videoDurationSec, sourceWidth, sourceHeight, transformationConfig, layoutMode, splitRatio, splitTopCrop, splitBottomCrop, pipScale, transcriptWords, playheadSec, cropKeyframes, clipStartSec, clipEndSec, captionPreset } = useTimelineStore();
  const setConfig = useTimelineStore((state) => state.setTransformationConfig);
  const setSplitRatio = useTimelineStore((state) => state.setSplitRatioValue);
  const setPipScale = useTimelineStore((state) => state.setPipScale);
  const setPlayhead = useTimelineStore((state) => state.setPlayhead);
  const setCaptionPreset = useTimelineStore((state) => state.setCaptionPreset);

  // Highlight escolhido na tela de resultados: abre o editor já no trecho.
  useEffect(() => {
    if (clipStartSec != null && clipEndSec != null) {
      setClipStart(Math.round(clipStartSec * 100) / 100);
      setClipEnd(Math.round(clipEndSec * 100) / 100);
    } else if (videoDurationSec > 0) {
      setClipEnd((end) => Math.min(end, Math.round(videoDurationSec)));
    }
  }, [clipStartSec, clipEndSec, videoDurationSec]);
  const downloadCaptions = () => {
    const stamp = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 23).replace(".", ",");
    const blocks = transcriptWords.map((word, index) => `${index + 1}\n${stamp(word.startSec)} --> ${stamp(word.endSec)}\n${word.word}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([blocks || "1\n00:00:00,000 --> 00:00:02,000\nLegenda premium"], { type: "text/srt" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "legendas-premium.srt";
    link.click();
    URL.revokeObjectURL(url);
  };
  const renderAndDownload = async () => {
    const selectedCrop = interpolateCrop(cropKeyframes, clipStart);
    // Caminho principal: render no backend com legendas queimadas (estilo escolhido).
    if (videoId) {
      // Layout da composição → layout do render. Split/gameplay/screenshare usam
      // os crops cima/baixo do editor; three-person ainda não tem render dedicado.
      let layout: RenderLayout = "single";
      let split: SplitRenderConfig | null = null;
      if (layoutMode === "fit" || layoutMode === "three-person") {
        layout = "fit";
      } else if ((layoutMode === "split" || layoutMode === "gameplay" || layoutMode === "screenshare") && splitTopCrop && splitBottomCrop) {
        layout = "split";
        split = { topCrop: splitTopCrop, bottomCrop: splitBottomCrop, ratio: splitRatio };
      }
      setRenderState({ status: "rendering", progress: 0 });
      try {
        const { renderId, jobId } = await requestRender(videoId, {
          startSec: clipStart,
          endSec: Math.max(clipStart + 1, clipEnd),
          withCaptions: captionPreset !== "none",
          captionStyle: captionPreset === "none" ? undefined : ((captionPreset as CaptionStyleId) || "mozi"),
          layout,
          split,
          // Enquadramento como está no editor (inclui ajustes manuais da caixa 9:16)
          cropKeyframes: layout === "split" || !selectedCrop
            ? null
            : [{ ...selectedCrop, tSec: clipStart }],
          speedPercent: transformationConfig.speedPercent,
        });
        await waitForJob(jobId, (p) => setRenderState({ status: "rendering", progress: p }));
        const link = document.createElement("a");
        link.href = renderFileUrl(renderId);
        link.download = "soluscut-final.mp4";
        link.click();
        setRenderState({ status: "idle", progress: 0 });
      } catch (e) {
        setRenderState({ status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // Fallback (vídeo carregado sem backend): rota local antiga com legendas soft.
    const file = getRenderSource();
    if (!file) return;
    const data = new FormData();
    data.append("video", file);
    data.append("start", String(clipStart));
    data.append("duration", String(Math.max(1, clipEnd - clipStart)));
    const crop = selectedCrop;
    if (crop) data.append("crop", JSON.stringify(crop));
    const stamp = (seconds: number) => new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 23).replace(".", ",");
    data.append("captions", transcriptWords.filter((word) => word.endSec >= clipStart && word.startSec <= clipEnd).map((word, index) => `${index + 1}\n${stamp(word.startSec - clipStart)} --> ${stamp(Math.min(word.endSec, clipEnd) - clipStart)}\n${word.word}`).join("\n\n"));
    const response = await fetch("/api/render", { method: "POST", body: data });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = "soluscut-final.mp4"; link.click(); URL.revokeObjectURL(url);
  };
  const addCut = () => setCutPoints((points) => points.some((point) => Math.abs(point - playheadSec) < 0.2) ? points : [...points, playheadSec].sort((a, b) => a - b));
  const removeCut = (point: number) => setCutPoints((points) => points.filter((item) => item !== point));

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
            {layoutMode === "screenshare" && <Slider label="Câmera pequena" value={pipScale} min={0.16} max={0.46} step={0.01} format={(value) => `${Math.round(value * 100)}%`} onChange={setPipScale} />}
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
                <div><span>INÍCIO</span><strong>{clipStart.toFixed(2)}</strong><small>segundos</small></div>
                <i>→</i>
                <div><span>FIM</span><strong>{clipEnd.toFixed(2)}</strong><small>segundos</small></div>
                <div className="duration-summary"><span>DURAÇÃO FINAL</span><strong>{formatDuration(Math.max(0, clipEnd - clipStart))}</strong></div>
              </div>
              <TimelineRuler
                clipStartSec={clipStart}
                clipEndSec={clipEnd}
                onClipRangeChange={(start, end) => {
                  setClipStart(Math.round(start * 100) / 100);
                  setClipEnd(Math.round(end * 100) / 100);
                }}
              />
              <div className="clip-range"><label>Início (s)<input type="number" min="0" max={Math.max(0, videoDurationSec - 1)} value={clipStart} onChange={(event) => { const value = Math.max(0, Number(event.target.value)); setClipStart(value); setPlayhead(value); }} /></label><label>Fim (s)<input type="number" min={clipStart + 1} max={videoDurationSec} value={clipEnd} onChange={(event) => setClipEnd(Math.max(clipStart + 1, Number(event.target.value)))} /></label><strong>Trecho: {formatDuration(Math.max(0, clipEnd - clipStart))}</strong><button type="button" onClick={() => { setClipStart(playheadSec); setClipEnd(Math.min(videoDurationSec, playheadSec + 30)); setPlayhead(playheadSec); }}>Selecionar 30 s no playhead</button></div>
              <div className="cut-controls"><div><strong>Cortes: {cutPoints.length + 1}</strong><span>Adicione quantos trechos precisar.</span></div><button type="button" onClick={addCut}>+ Adicionar corte no playhead</button></div>
              {cutPoints.length > 0 && <div className="cut-list">{cutPoints.map((point) => <button type="button" key={point} onClick={() => removeCut(point)}>Corte em {formatDuration(point)} ×</button>)}</div>}
              <SafeZoneTrack />
              {!captionStage ? (
                <button type="button" className="workflow-continue" onClick={() => setCaptionStage(true)}>Continuar para legendas →</button>
              ) : finalized ? (
                <div className="final-step">
                  <div><strong>Projeto pronto para exportar</strong><span>Composição e legenda premium confirmadas. Renderize o MP4 ou baixe as legendas.</span></div>
                  <button type="button" className="workflow-continue" onClick={renderAndDownload} disabled={renderState.status === "rendering"}>
                    {renderState.status === "rendering" ? `Renderizando… ${Math.round(renderState.progress * 100)}%` : "Renderizar e baixar MP4"}
                  </button>
                  {renderState.status === "error" && <span style={{ color: "#f66" }}>{renderState.error}</span>}
                  <button type="button" className="workflow-continue secondary" onClick={downloadCaptions}>Baixar .SRT</button>
                  <button type="button" className="workflow-continue secondary" onClick={() => setFinalized(false)}>Editar novamente</button>
                </div>
              ) : (
                <div className="caption-step">
                  <div><strong>Escolha a legenda premium</strong><span>O estilo selecionado será aplicado à prévia 9:16 e queimado no vídeo final.</span></div>
                  <div className="caption-presets">
                    {CAPTION_PRESET_OPTIONS.map((preset) => <button key={preset.id} type="button" className={captionPreset === preset.id ? "active" : ""} onClick={() => setCaptionPreset(preset.id)}><b>{preset.label}</b><small>{preset.hint}</small></button>)}
                  </div>
                  <button type="button" className="workflow-continue" onClick={() => setFinalized(true)}>Finalizar vídeo →</button>
                </div>
              )}
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
