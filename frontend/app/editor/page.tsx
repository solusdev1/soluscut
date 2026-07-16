"use client";

import { useState } from "react";
import { useTimelineStore } from "@/lib/store/useTimelineStore";
import { TimelineEditor } from "@/components/editor/TimelineEditor";
import {
  getVideoAnalysis,
  renderFileUrl,
  requestRender,
  uploadVideo,
  waitForJob,
  type AnalysisResult,
} from "@/lib/api";
import type { CaptionStyleId } from "@/lib/api";
import type { Highlight } from "@/lib/types/analyzer";
import { getRenderSource, setRenderSource } from "@/lib/renderSource";

// Rótulo de exibição → id do preset no backend ("none" desliga as legendas).
const STYLE_IDS: Record<string, CaptionStyleId | "none"> = {
  "No caption": "none",
  Beasty: "beasty",
  Karaokê: "karaoke",
  Mozi: "mozi",
  Popline: "popline",
};

type View = "setup" | "processing" | "results" | "editor";

interface RenderState {
  status: "idle" | "rendering" | "done" | "error";
  progress: number;
  url?: string;
  error?: string;
}

const DURATION_RANGES: Record<string, [number, number]> = {
  "<30s": [10, 30],
  "30s~59s": [30, 59],
  "60s~89s": [60, 89],
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function EditorPage() {
  const [view, setView] = useState<View>("setup");
  const [duration, setDuration] = useState("<30s");
  const [style, setStyle] = useState("Mozi");
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [renders, setRenders] = useState<Record<string, RenderState>>({});
  const [videoId, setVideoId] = useState<string | null>(null);

  const loadAnalysisData = useTimelineStore((s) => s.loadAnalysisData);
  const setClipRange = useTimelineStore((s) => s.setClipRange);
  const setCaptionPreset = useTimelineStore((s) => s.setCaptionPreset);

  const styleId = STYLE_IDS[style] ?? "mozi";
  const withCaptions = styleId !== "none";

  const chooseStyle = (item: string) => {
    setStyle(item);
    setCaptionPreset(STYLE_IDS[item] ?? "mozi"); // preview do editor usa o mesmo preset
  };

  const startAnalysis = async () => {
    const file = getRenderSource();
    if (!file) {
      setError("Importe um vídeo primeiro.");
      return;
    }
    setError(null);
    setView("processing");
    setProgress(0);
    setStep("Enviando vídeo…");
    try {
      const [minClipSec, maxClipSec] = DURATION_RANGES[duration] ?? [15, 60];
      const { videoId: vid, jobId } = await uploadVideo(file, { minClipSec, maxClipSec });
      setVideoId(vid);
      await waitForJob(jobId, (p, s) => {
        setProgress(p);
        setStep(s);
      });
      const analysis: AnalysisResult = await getVideoAnalysis(vid);

      loadAnalysisData({
        videoId: vid,
        videoUrl: URL.createObjectURL(file),
        videoDurationSec: analysis.durationSec,
        sourceWidth: analysis.sourceWidth,
        sourceHeight: analysis.sourceHeight,
        cropKeyframes: analysis.cropKeyframes,
        vadSegments: analysis.vadSegments,
        transcriptWords: analysis.transcriptWords,
      });
      setHighlights(analysis.highlights);
      setView("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView("setup");
    }
  };

  const openInEditor = (h: Highlight) => {
    setClipRange(h.startSec, h.endSec);
    setView("editor");
  };

  const renderWithAI = async (h: Highlight) => {
    if (!videoId) return;
    setRenders((r) => ({ ...r, [h.id]: { status: "rendering", progress: 0 } }));
    try {
      const { renderId, jobId } = await requestRender(videoId, {
        startSec: h.startSec,
        endSec: h.endSec,
        withCaptions,
        captionStyle: styleId === "none" ? undefined : styleId,
      });
      await waitForJob(jobId, (p) =>
        setRenders((r) => ({ ...r, [h.id]: { status: "rendering", progress: p } })),
      );
      setRenders((r) => ({
        ...r,
        [h.id]: { status: "done", progress: 1, url: renderFileUrl(renderId) },
      }));
    } catch (e) {
      setRenders((r) => ({
        ...r,
        [h.id]: { status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) },
      }));
    }
  };

  if (view === "setup")
    return (
      <main className="ai-setup">
        <header className="ai-nav">
          <a href="/">← Início</a>
          <strong>Soluscut</strong>
          <label className="video-input">
            {fileName ? `✓ ${fileName}` : "Importar vídeo"}
            <input
              type="file"
              accept="video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setRenderSource(file);
                  setFileName(file.name);
                  setError(null);
                }
              }}
            />
          </label>
        </header>
        <h1>Obter clipes em 1 clique</h1>
        <p>A IA analisa o vídeo, pontua os melhores momentos e gera clipes verticais com legendas.</p>
        {error && <p style={{ color: "#f66" }}>{error}</p>}
        <section>
          <h2>Recorte por IA</h2>
          <div className="ai-options">
            <label>
              Modelo
              <select>
                <option>Auto</option>
                <option>ClipAnything</option>
                <option>ClipBasic</option>
              </select>
            </label>
            <label>
              Gênero
              <select>
                <option>Auto</option>
                <option>Podcast</option>
                <option>Marketing</option>
                <option>Gameplay</option>
              </select>
            </label>
            <label>
              Duração
              <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option>&lt;30s</option>
                <option>30s~59s</option>
                <option>60s~89s</option>
              </select>
            </label>
            <label>
              Gancho automático<input type="checkbox" defaultChecked />
            </label>
          </div>
          <input className="ai-prompt" placeholder="Inclua momentos específicos" />
        </section>
        <section>
          <h2>Legendas premium</h2>
          <div className="caption-presets">
            {["No caption", "Beasty", "Karaokê", "Mozi", "Popline"].map((item) => (
              <button key={item} className={style === item ? "active" : ""} onClick={() => chooseStyle(item)}>
                <b>{item}</b>
                <small>Prévia de estilo</small>
              </button>
            ))}
          </div>
        </section>
        <button className="ai-start" onClick={startAnalysis} disabled={!fileName}>
          Analisar e obter clipes →
        </button>
      </main>
    );

  if (view === "processing")
    return (
      <main className="ai-setup">
        <h1>Analisando seu vídeo…</h1>
        <p>{step || "Preparando…"}</p>
        <div style={{ background: "#222", borderRadius: 8, overflow: "hidden", height: 14, maxWidth: 480 }}>
          <div
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: "100%",
              background: "linear-gradient(90deg,#7c3aed,#22d3ee)",
              transition: "width .5s",
            }}
          />
        </div>
        <p>{Math.round(progress * 100)}%</p>
      </main>
    );

  if (view === "results")
    return (
      <main className="ai-setup">
        <h1>Clipes sugeridos pela IA</h1>
        <p>Escolha um momento para editar, ou deixe a IA gerar o clipe pronto com legendas.</p>
        <section>
          <h2>Estilo de legenda</h2>
          <div className="caption-presets">
            {["No caption", "Beasty", "Karaokê", "Mozi", "Popline"].map((item) => (
              <button key={item} className={style === item ? "active" : ""} onClick={() => chooseStyle(item)}>
                <b>{item}</b>
                <small>{item === "No caption" ? "Sem legendas" : "Aplicado ao gerar"}</small>
              </button>
            ))}
          </div>
        </section>
        {highlights.length === 0 && <p>Nenhum momento com fala foi encontrado neste vídeo.</p>}
        {highlights.map((h) => {
          const render = renders[h.id] ?? { status: "idle", progress: 0 };
          return (
            <section className="result-card" key={h.id}>
              <div className="result-thumb">
                PRÉVIA
                <br />
                <b>
                  {fmtTime(h.startSec)}–{fmtTime(h.endSec)}
                </b>
              </div>
              <div>
                <h2>
                  {h.title} <em>Nota {Math.round(h.score)}</em>
                </h2>
                <p>{h.reason}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="ai-start" onClick={() => openInEditor(h)}>
                    Editar clipe →
                  </button>
                  {render.status === "idle" && (
                    <button className="ai-start" onClick={() => renderWithAI(h)}>
                      {withCaptions ? "Gerar com IA (legendas) ✨" : "Gerar com IA ✨"}
                    </button>
                  )}
                  {render.status === "rendering" && (
                    <button className="ai-start" disabled>
                      Renderizando… {Math.round(render.progress * 100)}%
                    </button>
                  )}
                  {render.status === "done" && render.url && (
                    <a className="ai-start" href={render.url} download>
                      Baixar clipe ⬇
                    </a>
                  )}
                  {render.status === "error" && (
                    <button className="ai-start" onClick={() => renderWithAI(h)} title={render.error}>
                      Erro — tentar de novo ↻
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
        <button className="ai-start" style={{ marginTop: 16 }} onClick={() => setView("setup")}>
          ← Analisar outro vídeo
        </button>
      </main>
    );

  return <TimelineEditor />;
}
