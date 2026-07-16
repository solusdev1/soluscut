"""Gera legendas .ass animadas "Hormozi-style" a partir do transcript.json.

Características:
  - agrupamento em blocos curtos (até 4 palavras / 2.5s);
  - pop-in scale word-by-word via tags \\t(\\fscx\\fscy);
  - highlight da palavra "quente" (a mais longa/enfática do bloco) em amarelo neon;
  - posicionamento no terço inferior do quadro 9:16.

Uso:
    python generate_ass.py transcript.json output.ass [--font Montserrat] [--play-res 1080x1920]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

MAX_WORDS_PER_BLOCK = 4
MAX_BLOCK_DURATION = 2.5

# Cores ASS em &HAABBGGRR
WHITE = "&H00FFFFFF"
DIM_GREY = "&H00999999"
NEON_YELLOW = "&H0000F7FF"  # amarelo neon (BGR)
NEON_GREEN = "&H0066FF00"   # verde neon (BGR)
NEON_CYAN = "&H00FFE500"    # ciano (BGR)
OUTLINE_BLACK = "&H00000000"

# Fração da altura do quadro entre a base do texto e a borda inferior.
# 0.12 deixa a legenda no rodapé sem colar na UI dos apps (antes era 0.28 — "no meio").
DEFAULT_MARGIN_V_FRAC = 0.12

# Presets de legenda expostos ao frontend.
#   mode "popin"   → palavra aparece no timestamp com pop de escala (Hormozi)
#   mode "karaoke" → bloco inteiro visível apagado; palavra acende ao ser falada
#   mode "popline" → bloco inteiro visível; palavra ativa ganha cor + pop
STYLE_PRESETS: dict[str, dict] = {
    "mozi": {"mode": "popin", "highlight": NEON_YELLOW, "outline": 4, "fs_frac": 0.045},
    "beasty": {"mode": "popin", "highlight": NEON_GREEN, "outline": 5, "fs_frac": 0.050},
    "karaoke": {"mode": "karaoke", "highlight": NEON_YELLOW, "outline": 4, "fs_frac": 0.045},
    "popline": {"mode": "popline", "highlight": NEON_CYAN, "outline": 4, "fs_frac": 0.045},
}

STOPWORDS = {
    "a", "o", "e", "de", "da", "do", "em", "um", "uma", "que", "com", "para", "por",
    "the", "a", "an", "and", "of", "to", "in", "is", "it", "on", "for", "with",
}


def sec_to_ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def group_words(words: list[dict]) -> list[list[dict]]:
    blocks: list[list[dict]] = []
    current: list[dict] = []
    for w in words:
        if current and (
            len(current) >= MAX_WORDS_PER_BLOCK
            or w["end_sec"] - current[0]["start_sec"] > MAX_BLOCK_DURATION
            or w["start_sec"] - current[-1]["end_sec"] > 1.0  # pausa longa fecha o bloco
        ):
            blocks.append(current)
            current = []
        current.append(w)
    if current:
        blocks.append(current)
    return blocks


def pick_keyword(block: list[dict]) -> int:
    """Índice da palavra a destacar: a mais longa que não seja stopword."""
    best_idx, best_len = -1, 0
    for i, w in enumerate(block):
        clean = re.sub(r"\W", "", w["word"]).lower()
        if clean and clean not in STOPWORDS and len(clean) > best_len:
            best_idx, best_len = i, len(clean)
    return best_idx


def build_dialogue(
    block: list[dict],
    pop_scale: int = 120,
    style: str = "mozi",
    next_block_start: float | None = None,
) -> str:
    """Um evento Dialogue por bloco, animado conforme o preset de estilo."""
    preset = STYLE_PRESETS.get(style, STYLE_PRESETS["mozi"])
    mode = preset["mode"]
    highlight = preset["highlight"]

    start = block[0]["start_sec"]
    end = block[-1]["end_sec"] + 0.15
    # Nunca invadir o bloco seguinte — eventos sobrepostos são empilhados
    # pelo libass e aparecem como texto duplicado na tela.
    if next_block_start is not None:
        end = min(end, max(start + 0.05, next_block_start - 0.01))
    keyword_idx = pick_keyword(block)

    parts: list[str] = []
    for i, w in enumerate(block):
        rel_ms = int((w["start_sec"] - start) * 1000)
        end_ms = int((w["end_sec"] - start) * 1000)

        if mode == "popin":
            # Palavra invisível até seu timestamp, então pop-in de pop_scale% → 100%
            color = highlight if i == keyword_idx else WHITE
            parts.append(
                f"{{\\c{color}\\alpha&HFF&\\t({rel_ms},{rel_ms},\\alpha&H00&\\fscx{pop_scale}\\fscy{pop_scale})"
                f"\\t({rel_ms},{rel_ms + 120},\\fscx100\\fscy100)}}{w['word'].upper()} "
            )
        elif mode == "karaoke":
            # Bloco inteiro visível apagado; a palavra acende quando falada
            parts.append(
                f"{{\\c{DIM_GREY}\\t({rel_ms},{rel_ms},\\c{highlight})"
                f"\\t({end_ms},{end_ms + 80},\\c{WHITE})}}{w['word'].upper()} "
            )
        else:  # popline
            # Bloco visível em branco; palavra ativa ganha cor + pop enquanto é falada
            parts.append(
                f"{{\\c{WHITE}\\t({rel_ms},{rel_ms + 100},\\c{highlight}\\fscx{pop_scale}\\fscy{pop_scale})"
                f"\\t({end_ms},{end_ms + 100},\\c{WHITE}\\fscx100\\fscy100)}}{w['word'].upper()} "
            )

    text = "".join(parts).strip()
    return f"Dialogue: 0,{sec_to_ass_time(start)},{sec_to_ass_time(end)},Hormozi,,0,0,0,,{text}"


def generate_ass(
    transcript: dict,
    font: str,
    play_res: tuple[int, int],
    pop_scale: int,
    style: str = "mozi",
    margin_v_frac: float = DEFAULT_MARGIN_V_FRAC,
) -> str:
    preset = STYLE_PRESETS.get(style, STYLE_PRESETS["mozi"])
    res_x, res_y = play_res
    font_size = int(res_y * preset["fs_frac"])
    header = f"""[Script Info]
Title: Hydra Creator captions
ScriptType: v4.00+
PlayResX: {res_x}
PlayResY: {res_y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hormozi,{font},{font_size},{WHITE},{WHITE},{OUTLINE_BLACK},&H80000000,-1,0,0,0,100,100,0,0,1,{preset['outline']},2,2,60,60,{int(res_y * margin_v_frac)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    words = transcript.get("words", [])
    blocks = group_words(words)
    lines = [
        build_dialogue(
            block,
            pop_scale,
            style=style,
            next_block_start=blocks[i + 1][0]["start_sec"] if i + 1 < len(blocks) else None,
        )
        for i, block in enumerate(blocks)
    ]
    return header + "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera legendas .ass Hormozi-style")
    parser.add_argument("transcript", help="transcript.json do analyzer")
    parser.add_argument("output", help="arquivo .ass de saída")
    parser.add_argument("--font", default="Montserrat")
    parser.add_argument("--play-res", default="1080x1920")
    parser.add_argument("--pop-scale", type=int, default=120)
    parser.add_argument("--style", default="mozi", choices=sorted(STYLE_PRESETS))
    parser.add_argument("--margin-v-frac", type=float, default=DEFAULT_MARGIN_V_FRAC)
    args = parser.parse_args()

    transcript = json.loads(Path(args.transcript).read_text(encoding="utf-8"))
    res_x, res_y = (int(v) for v in args.play_res.split("x"))
    ass = generate_ass(
        transcript,
        font=args.font,
        play_res=(res_x, res_y),
        pop_scale=args.pop_scale,
        style=args.style,
        margin_v_frac=args.margin_v_frac,
    )
    Path(args.output).write_text(ass, encoding="utf-8")
    n_words = len(transcript.get("words", []))
    print(f"OK: {args.output} ({n_words} palavras)")


if __name__ == "__main__":
    main()
