"""Renderizador de clipes do Hydra Creator — 100% Python + FFmpeg.

Equivalente cross-platform do transform_chain.sh (que exige bash): corta o
trecho escolhido, aplica crop 9:16 dinâmico seguindo os keyframes, color
grading leve, film grain, legendas .ass animadas e (opcional) BGM com ducking
por VAD. Reusa generate_filters.py e generate_ass.py como bibliotecas.

Uso CLI:
    python -m app.render.renderer --input video.mp4 --analysis-dir output/analysis \
        --output clip.mp4 --start 12.5 --end 42.0
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.transform.generate_ass import generate_ass
from app.transform.generate_filters import (
    build_bgm_volume_filter,
    build_crop_filter,
    build_split_video_filter,
)

logger = logging.getLogger("hydra.renderer")

OUT_W = 1080
OUT_H = 1920

_encoder_cache: str | None = None
_pitch_filter_cache: bool | None = None


@dataclass
class RenderOptions:
    with_captions: bool = True
    caption_style: str = "mozi"  # mozi | beasty | karaoke | popline
    layout: str = "single"       # single (preencher) | fit (ajustar + fundo) | split (tela dividida)
    split_config: dict | None = None  # {"topCrop": {x,y,w,h}, "bottomCrop": {...}, "ratio": 0.5}
    # Enquadramento editado manualmente no frontend (timestamps na linha do tempo
    # original). Quando presente, substitui os keyframes da análise.
    crop_override: list[dict] | None = None
    font: str = "Montserrat"
    pop_scale: int = 120
    bgm_path: str | None = None
    pitch_percent: float = 0.0   # 0 = voz natural; 1.5 = anti-fingerprint padrão
    speed_percent: float = 0.0
    grain: float = 0.04
    zoom_min: float = 1.0
    zoom_max: float = 1.12
    seed: int | None = None
    color_grade: dict = field(
        default_factory=lambda: {"contrast": 1.05, "saturation": 1.05, "gamma": 0.98}
    )
    duck_speech: float = 0.15
    duck_silence: float = 0.80


# ---------------------------------------------------------------------------
# Detecção de capacidades do FFmpeg (cacheada por processo)
# ---------------------------------------------------------------------------

def _require_binary(name: str) -> None:
    if not shutil.which(name):
        raise RuntimeError(f"'{name}' não encontrado no PATH. Instale o FFmpeg.")


def detect_video_encoder() -> str:
    """'h264_nvenc' se GPU NVIDIA disponível, senão 'libx264'."""
    global _encoder_cache
    if _encoder_cache is not None:
        return _encoder_cache
    _encoder_cache = "libx264"
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=15
        )
        if "h264_nvenc" in proc.stdout and shutil.which("nvidia-smi"):
            _encoder_cache = "h264_nvenc"
    except Exception:  # noqa: BLE001 — fallback CPU sempre funciona
        pass
    logger.info("Encoder de vídeo: %s", _encoder_cache)
    return _encoder_cache


def _has_rubberband() -> bool:
    global _pitch_filter_cache
    if _pitch_filter_cache is None:
        try:
            proc = subprocess.run(
                ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, timeout=15
            )
            _pitch_filter_cache = "rubberband" in proc.stdout
        except Exception:  # noqa: BLE001
            _pitch_filter_cache = False
    return _pitch_filter_cache


# ---------------------------------------------------------------------------
# Recorte dos artefatos de análise para a janela [start, end]
# ---------------------------------------------------------------------------

def _slice_crop_keyframes(crop_data: dict, start: float, end: float) -> dict:
    """Keyframes dentro da janela, com t re-referenciado ao início do clipe."""
    kfs = [k for k in crop_data["keyframes"] if start - 2.0 <= k["t_sec"] <= end + 2.0]
    if not kfs:
        kfs = crop_data["keyframes"][-1:] or []
    sliced = []
    for k in kfs:
        nk = dict(k)
        nk["t_sec"] = round(max(0.0, k["t_sec"] - start), 3)
        sliced.append(nk)
    if not sliced:
        # Sem keyframes: crop central estático 9:16
        src_w, src_h = crop_data["source_width"], crop_data["source_height"]
        h = src_h - (src_h % 2)
        w = min(src_w, int(h * 9 / 16))
        w -= w % 2
        sliced = [{"t_sec": 0.0, "x": (src_w - w) // 2, "y": 0, "w": w, "h": h, "confidence": 0.0, "source": "center"}]
    return {**crop_data, "keyframes": sliced}


def _slice_vad(vad_data: dict, start: float, end: float) -> dict:
    segments = []
    for seg in vad_data.get("segments", []):
        s = max(seg["start_sec"], start)
        e = min(seg["end_sec"], end)
        if e - s > 1e-3:
            segments.append(
                {"start_sec": round(s - start, 3), "end_sec": round(e - start, 3), "is_speech": seg["is_speech"]}
            )
    return {"segments": segments}


def _slice_transcript(transcript: dict, start: float, end: float) -> dict:
    """Palavras dentro da janela, timestamps re-referenciados ao início do clipe."""
    words = []
    for w in transcript.get("words", []):
        if w["end_sec"] <= start or w["start_sec"] >= end:
            continue
        words.append(
            {
                "word": w["word"],
                "start_sec": round(max(0.0, w["start_sec"] - start), 3),
                "end_sec": round(min(end, w["end_sec"]) - start, 3),
                "confidence": w.get("confidence", 1.0),
            }
        )
    return {"language": transcript.get("language", "unknown"), "words": words, "segments": []}


def _escape_filter_path(path: str) -> str:
    """Escapa um path Windows para uso dentro de um filtergraph (libass)."""
    return path.replace("\\", "/").replace(":", "\\:")


def _probe_has_audio(video_path: str) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True,
    )
    return bool(proc.stdout.strip())


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_clip(
    input_video: str,
    analysis_dir: str,
    output_path: str,
    start_sec: float,
    end_sec: float,
    options: RenderOptions | None = None,
    progress_cb=None,
) -> dict:
    """Renderiza o clipe vertical [start_sec, end_sec] com a cadeia completa.

    Retorna a config efetiva usada (também gravada ao lado do output, para o
    compliance score). `progress_cb(fraction, step)` reporta o andamento do
    encode lendo `-progress` do FFmpeg.
    """
    _require_binary("ffmpeg")
    _require_binary("ffprobe")
    opts = options or RenderOptions()

    analysis = Path(analysis_dir)
    crop_data = json.loads((analysis / "crop_keyframes.json").read_text(encoding="utf-8"))
    vad_data = json.loads((analysis / "vad_segments.json").read_text(encoding="utf-8"))
    transcript = json.loads((analysis / "transcript.json").read_text(encoding="utf-8"))

    if opts.crop_override:
        # Enquadramento manual do editor no lugar dos keyframes automáticos,
        # clampado aos limites do frame fonte.
        src_w, src_h = crop_data["source_width"], crop_data["source_height"]
        sane = []
        for k in opts.crop_override:
            w = max(2, min(int(k["w"]) & ~1, src_w))
            h = max(2, min(int(k["h"]) & ~1, src_h))
            sane.append(
                {
                    "t_sec": float(k.get("t_sec", 0.0)),
                    "x": max(0, min(int(k["x"]), src_w - w)),
                    "y": max(0, min(int(k["y"]), src_h - h)),
                    "w": w,
                    "h": h,
                    "confidence": 1.0,
                    "source": "center",
                }
            )
        if sane:
            crop_data = {**crop_data, "keyframes": sorted(sane, key=lambda k: k["t_sec"])}

    duration = max(0.5, end_sec - start_sec)
    crop_sliced = _slice_crop_keyframes(crop_data, start_sec, end_sec)
    vad_sliced = _slice_vad(vad_data, start_sec, end_sec)
    transcript_sliced = _slice_transcript(transcript, start_sec, end_sec)

    def report(fraction: float, step: str) -> None:
        if progress_cb is not None:
            progress_cb(fraction, step)

    report(0.02, "Preparando filtros")
    work = Path(tempfile.mkdtemp(prefix="hydra_render_"))
    try:
        # --- vídeo: (layout -> [cropped]) -> grade -> grain [-> legendas] ---
        if opts.layout == "fit":
            # Região selecionada centralizada sobre o próprio vídeo desfocado
            # (Ajustar + fundo). O preview usa o mesmo retângulo — sem o crop
            # aqui, partes excluídas no editor (ex.: legenda queimada da fonte)
            # vazariam para o vídeo final.
            rect = crop_sliced["keyframes"][0]
            fg_crop = ""
            src_w, src_h = crop_sliced["source_width"], crop_sliced["source_height"]
            if rect["w"] < src_w or rect["h"] < src_h:
                fg_crop = f"crop={rect['w']}:{rect['h']}:{rect['x']}:{rect['y']},"
            cropped_stage = (
                f"[0:v]split=2[bgsrc][fgsrc];"
                f"[bgsrc]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,"
                f"crop={OUT_W}:{OUT_H},boxblur=24:2,eq=brightness=-0.2[bgblur];"
                f"[fgsrc]{fg_crop}scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=decrease"
                f":force_divisible_by=2:flags=lanczos[fgfit];"
                f"[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,setsar=1[cropped]"
            )
        elif opts.layout == "split" and opts.split_config:
            # Tela dividida cima/baixo — mesmos crops do editor, com split do stream
            # de entrada (um pad de input não pode ser consumido duas vezes).
            sc = opts.split_config
            ratio = float(sc.get("ratio", 0.5))
            top_h = int(round(OUT_H * ratio)) & ~1
            bottom_h = OUT_H - top_h

            def crop_scale(rect: dict, target_h: int, src: str, tag: str) -> str:
                x, y, w, h = int(rect["x"]), int(rect["y"]), int(rect["w"]), int(rect["h"])
                return (
                    f"[{src}]crop={w}:{h}:{x}:{y},scale={OUT_W}:{target_h}:flags=lanczos,setsar=1[{tag}]"
                )

            cropped_stage = (
                f"[0:v]split=2[spa][spb];"
                f"{crop_scale(sc['topCrop'], top_h, 'spa', 'sptop')};"
                f"{crop_scale(sc['bottomCrop'], bottom_h, 'spb', 'spbot')};"
                f"[sptop][spbot]vstack=inputs=2[cropped]"
            )
        else:
            # single (Preencher): crop 9:16 dinâmico seguindo os keyframes + micro-zoom
            crop_filter = build_crop_filter(
                crop_sliced,
                zoom_min=opts.zoom_min,
                zoom_max=opts.zoom_max,
                zoom_interval_range=(10.0, 15.0),
                duration_sec=duration,
                seed=opts.seed,
            )
            cropped_stage = f"[0:v]{crop_filter},scale={OUT_W}:{OUT_H}:flags=lanczos,setsar=1[cropped]"

        video_chain = (
            f"{cropped_stage};"
            f"[cropped]eq=contrast={opts.color_grade['contrast']}:saturation={opts.color_grade['saturation']}"
            f":gamma={opts.color_grade['gamma']}[graded];"
            f"[graded]noise=alls={max(0, int(opts.grain * 255))}:allf=t+u,format=yuv420p[grained]"
        )

        captions_rendered = False
        if opts.with_captions and transcript_sliced["words"]:
            ass_file = work / "captions.ass"
            ass_file.write_text(
                generate_ass(
                    transcript_sliced,
                    font=opts.font,
                    play_res=(OUT_W, OUT_H),
                    pop_scale=opts.pop_scale,
                    style=opts.caption_style,
                ),
                encoding="utf-8",
            )
            video_chain += f";[grained]ass='{_escape_filter_path(str(ass_file))}'[vout]"
            captions_rendered = True
        else:
            video_chain += ";[grained]null[vout]"

        # --- áudio: voz (pitch/speed opcional) [+ BGM com ducking] ---
        has_audio = _probe_has_audio(input_video)
        audio_filters: list[str] = []
        if has_audio:
            if opts.pitch_percent:
                ratio = 1 + opts.pitch_percent / 100
                if _has_rubberband():
                    audio_filters.append(f"rubberband=pitch={ratio:.5f}")
                else:
                    # Normaliza para 48k antes do asetrate para o fator de pitch ser exato
                    audio_filters.append(f"aresample=48000,asetrate={int(48000 * ratio)},aresample=48000")
            if opts.speed_percent:
                audio_filters.append(f"atempo={1 + opts.speed_percent / 100:.5f}")
            voice_chain = f"[0:a]{','.join(audio_filters) if audio_filters else 'anull'}[voice]"

        bgm = opts.bgm_path if (opts.bgm_path and Path(opts.bgm_path).exists() and has_audio) else None

        # --- montar filtergraph + comando ---
        parts = [video_chain]
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
               "-ss", f"{start_sec:.3f}", "-t", f"{duration:.3f}", "-i", str(input_video)]
        maps = ["-map", "[vout]"]

        if bgm:
            volume_filter = build_bgm_volume_filter(
                vad_sliced, duck_speech=opts.duck_speech, duck_silence=opts.duck_silence, crossfade_sec=0.5
            )
            parts.append(voice_chain)
            parts.append(f"[1:a]aloop=loop=-1:size=2e9,atrim=0:{duration:.3f},{volume_filter}[bgm]")
            parts.append("[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
            cmd += ["-i", str(bgm)]
            maps += ["-map", "[aout]"]
        elif has_audio:
            parts.append(voice_chain)
            maps += ["-map", "[voice]"]

        filter_file = work / "filtergraph.txt"
        filter_file.write_text(";\n".join(parts), encoding="utf-8")

        encoder = detect_video_encoder()
        vencoder = (
            ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "20"]
            if encoder == "h264_nvenc"
            else ["-c:v", "libx264", "-preset", "medium", "-crf", "20"]
        )
        cmd += ["-filter_complex_script", str(filter_file)] + maps + vencoder
        if has_audio:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        cmd += ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(output_path)]

        report(0.05, "Renderizando (FFmpeg)")
        logger.info("FFmpeg: %s", " ".join(cmd))
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            if line.startswith("out_time_ms="):
                try:
                    out_sec = int(line.split("=", 1)[1]) / 1_000_000
                    report(min(0.98, 0.05 + 0.93 * out_sec / duration), "Renderizando (FFmpeg)")
                except ValueError:
                    pass
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise RuntimeError(f"FFmpeg falhou (código {proc.returncode}): {stderr.strip()[-2000:]}")

        config = {
            "start_sec": start_sec,
            "end_sec": end_sec,
            "layout": opts.layout,
            "zoomMinScale": opts.zoom_min,
            "zoomMaxScale": opts.zoom_max,
            "zoomIntervalSec": 12.0,
            "grainOpacity": opts.grain,
            "colorGradeParams": opts.color_grade,
            "pitchShiftPercent": opts.pitch_percent,
            "speedPercent": opts.speed_percent,
            "bgmTrackUrl": bgm,
            "bgmDuckSpeechLevel": opts.duck_speech,
            "bgmDuckSilenceLevel": opts.duck_silence,
            "bgmCrossfadeSec": 0.5,
            "captions": captions_rendered,
            "captionStyle": {
                "preset": opts.caption_style,
                "fontFamily": opts.font,
                "popInScale": opts.pop_scale / 100,
                "keywordHighlight": True,
            },
            "renderEngine": encoder,
        }
        # Um config por render (o nome fixo era sobrescrito a cada clipe)
        config_path = Path(output_path).with_suffix(".config.json")
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

        report(1.0, "Clipe pronto")
        return config
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Hydra Creator — render de clipe vertical")
    parser.add_argument("--input", required=True)
    parser.add_argument("--analysis-dir", required=True, help="Diretório com os JSONs do analyzer")
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--no-captions", action="store_true")
    parser.add_argument("--bgm", default=None)
    parser.add_argument("--pitch", type=float, default=0.0)
    parser.add_argument("--speed", type=float, default=0.0)
    parser.add_argument("--font", default="Montserrat")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = render_clip(
        input_video=args.input,
        analysis_dir=args.analysis_dir,
        output_path=args.output,
        start_sec=args.start,
        end_sec=args.end,
        options=RenderOptions(
            with_captions=not args.no_captions,
            bgm_path=args.bgm,
            pitch_percent=args.pitch,
            speed_percent=args.speed,
            font=args.font,
            seed=args.seed,
        ),
        progress_cb=lambda f, s: print(f"[{f * 100:5.1f}%] {s}"),
    )
    print(json.dumps(config, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
