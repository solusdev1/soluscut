"""Gera expressões FFmpeg dinâmicas a partir dos JSONs de análise.

Saídas (arquivos de texto consumidos pelo transform_chain.sh):
  - crop_expr.txt   → filtro crop com expressões x/w interpoladas por keyframe + micro-zoom
  - volume_expr.txt → filtro volume (eval=frame) do BGM com ducking suavizado por VAD

Uso:
    python generate_filters.py --crop crop_keyframes.json --vad vad_segments.json \
        --output-dir /tmp/filters [--zoom-min 1.0 --zoom-max 1.15] \
        [--duck-speech 0.15 --duck-silence 0.80 --crossfade 0.5] [--seed 42]
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


def _lerp_expr(t0: float, v0: float, t1: float, v1: float) -> str:
    """Expressão FFmpeg de interpolação linear entre (t0,v0) e (t1,v1)."""
    if t1 <= t0:
        return f"{v1:.4f}"
    return f"({v0:.4f}+({v1:.4f}-{v0:.4f})*(t-{t0:.3f})/{t1 - t0:.3f})"


def _piecewise(points: list[tuple[float, float]], default: float) -> str:
    """Constrói expressão if(between(...)) encadeada com interpolação linear entre pontos.

    FFmpeg tem limite prático de tamanho de expressão; para vídeos longos os keyframes
    são reduzidos (downsample) antes de chegar aqui.
    """
    if not points:
        return f"{default:.4f}"
    if len(points) == 1:
        return f"{points[0][1]:.4f}"

    expr = f"{points[-1][1]:.4f}"  # valor após o último ponto
    for (t0, v0), (t1, v1) in zip(reversed(points[:-1]), reversed(points[1:])):
        expr = f"if(between(t,{t0:.3f},{t1:.3f}),{_lerp_expr(t0, v0, t1, v1)},{expr})"
    return expr


def _downsample(items: list, max_items: int) -> list:
    if len(items) <= max_items:
        return items
    step = len(items) / max_items
    return [items[int(i * step)] for i in range(max_items)] + [items[-1]]


def build_crop_filter(
    crop_data: dict,
    zoom_min: float,
    zoom_max: float,
    zoom_interval_range: tuple[float, float],
    duration_sec: float,
    seed: int | None,
    max_keyframes: int = 60,
) -> str:
    """Filtro crop dinâmico 9:16 seguindo keyframes, com micro-zoom aleatório embutido.

    O zoom é aplicado reduzindo a janela de crop (w/zoom) — mais estável que zoompan
    para vídeo não-estático — e o scale final para 1080x1920 acontece no .sh.
    """
    rng = random.Random(seed)
    kfs = _downsample(crop_data["keyframes"], max_keyframes)
    src_w = crop_data["source_width"]
    src_h = crop_data["source_height"]

    base_w = kfs[0]["w"]
    base_h = kfs[0]["h"]

    # Pontos de zoom: novo alvo aleatório a cada 10–15s, easing linear entre pontos
    zoom_points: list[tuple[float, float]] = [(0.0, 1.0)]
    t = 0.0
    while t < duration_sec:
        t += rng.uniform(*zoom_interval_range)
        zoom_points.append((min(t, duration_sec), rng.uniform(zoom_min, zoom_max)))
    zoom_expr = _piecewise(zoom_points, 1.0)

    # Centro X interpolado entre keyframes
    cx_points = [(kf["t_sec"], kf["x"] + kf["w"] / 2) for kf in kfs]
    cx_expr = _piecewise(cx_points, src_w / 2)

    # Janela efetiva: base dividida pelo zoom; centro clampado aos limites do frame
    # No filtro crop do FFmpeg as variáveis são: iw/ih (entrada), ow/oh (saída).
    # w/h NÃO existem aqui — por isso x/y referenciam ow/oh e iw/ih.
    # min(iw/ih, ...) garante que a janela nunca ultrapasse o frame de entrada.
    w_expr = f"min(iw,floor(({base_w}/({zoom_expr}))/2)*2)"
    h_expr = f"min(ih,floor(({base_h}/({zoom_expr}))/2)*2)"
    x_expr = f"max(0,min(({cx_expr})-ow/2,iw-ow))"
    y_expr = "max(0,min((ih-oh)/2,ih-oh))"

    # Cada valor é envolvido em aspas simples no filtergraph — as aspas já protegem
    # as vírgulas do parser; não escapamos com backslash (causaria erro no eval).
    return f"crop=w='{w_expr}':h='{h_expr}':x='{x_expr}':y='{y_expr}'"


def build_bgm_volume_filter(
    vad_data: dict,
    duck_speech: float,
    duck_silence: float,
    crossfade_sec: float,
) -> str:
    """Filtro volume do BGM com ducking por VAD e crossfade linear nas transições."""
    segments = vad_data.get("segments", [])
    if not segments:
        return f"volume={duck_silence}"

    # Pontos (t, volume) com rampas de crossfade em cada transição de estado
    points: list[tuple[float, float]] = []
    half = crossfade_sec / 2
    prev_level = duck_speech if segments[0]["is_speech"] else duck_silence
    points.append((0.0, prev_level))
    for seg in segments[1:]:
        level = duck_speech if seg["is_speech"] else duck_silence
        if level != prev_level:
            t = seg["start_sec"]
            points.append((max(0.0, t - half), prev_level))
            points.append((t + half, level))
            prev_level = level

    expr = _piecewise(_downsample(points, 120), duck_silence)
    return f"volume=volume='{expr}':eval=frame"


def build_split_video_filter(
    split_config: dict,
    out_w: int = 1080,
    out_h: int = 1920,
) -> str:
    """Filtro de tela dividida: crop das faixas de cima/baixo empilhadas (vstack).

    split_config = {"topCrop": {x,y,w,h}, "bottomCrop": {x,y,w,h}, "ratio": 0.5}
    Retorna uma cadeia [0:v]...[cropped] pronta para o resto do pipeline.
    """
    ratio = float(split_config.get("ratio", 0.5))
    top_h = int(round(out_h * ratio)) & ~1  # par
    bottom_h = out_h - top_h

    def crop_scale(rect: dict, target_h: int, tag: str) -> str:
        x, y, w, h = int(rect["x"]), int(rect["y"]), int(rect["w"]), int(rect["h"])
        return (
            f"[0:v]crop={w}:{h}:{x}:{y},scale={out_w}:{target_h}:flags=lanczos,setsar=1[{tag}]"
        )

    top = crop_scale(split_config["topCrop"], top_h, "sptop")
    bottom = crop_scale(split_config["bottomCrop"], bottom_h, "spbot")
    return f"{top};{bottom};[sptop][spbot]vstack=inputs=2[cropped]"


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera expressões FFmpeg de crop/zoom e ducking")
    parser.add_argument("--crop", required=True)
    parser.add_argument("--vad", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--duration", type=float, required=True, help="Duração do vídeo (s)")
    parser.add_argument("--zoom-min", type=float, default=1.0)
    parser.add_argument("--zoom-max", type=float, default=1.15)
    parser.add_argument("--zoom-interval-min", type=float, default=10.0)
    parser.add_argument("--zoom-interval-max", type=float, default=15.0)
    parser.add_argument("--duck-speech", type=float, default=0.15)
    parser.add_argument("--duck-silence", type=float, default=0.80)
    parser.add_argument("--crossfade", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=None, help="Seed para reprodutibilidade em testes")
    parser.add_argument("--layout", choices=["single", "split"], default="single")
    parser.add_argument("--split-config", default=None, help="JSON com topCrop/bottomCrop/ratio (layout=split)")
    args = parser.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    crop_data = json.loads(Path(args.crop).read_text(encoding="utf-8"))
    vad_data = json.loads(Path(args.vad).read_text(encoding="utf-8"))

    if args.layout == "split":
        if not args.split_config:
            parser.error("--layout=split exige --split-config")
        split_config = json.loads(Path(args.split_config).read_text(encoding="utf-8"))
        split_filter = build_split_video_filter(split_config)
        (out / "split_expr.txt").write_text(split_filter, encoding="utf-8")
        print(f"OK: {out / 'split_expr.txt'}")
    else:
        crop_filter = build_crop_filter(
            crop_data,
            zoom_min=args.zoom_min,
            zoom_max=args.zoom_max,
            zoom_interval_range=(args.zoom_interval_min, args.zoom_interval_max),
            duration_sec=args.duration,
            seed=args.seed,
        )
        (out / "crop_expr.txt").write_text(crop_filter, encoding="utf-8")
        print(f"OK: {out / 'crop_expr.txt'}")

    volume_filter = build_bgm_volume_filter(
        vad_data,
        duck_speech=args.duck_speech,
        duck_silence=args.duck_silence,
        crossfade_sec=args.crossfade,
    )
    (out / "volume_expr.txt").write_text(volume_filter, encoding="utf-8")
    print(f"OK: {out / 'volume_expr.txt'}")


if __name__ == "__main__":
    main()
