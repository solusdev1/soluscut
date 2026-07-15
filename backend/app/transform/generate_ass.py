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
NEON_YELLOW = "&H0000F7FF"  # amarelo neon (BGR)
OUTLINE_BLACK = "&H00000000"

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


def build_dialogue(block: list[dict], pop_scale: int = 120) -> str:
    """Um evento Dialogue por bloco, com karaoke de pop-in por palavra.

    Cada palavra entra com escala pop_scale% e assenta em 100% em 120ms,
    sincronizada pelo timestamp relativo ao início do bloco (tag \\t com offsets).
    """
    start = block[0]["start_sec"]
    end = block[-1]["end_sec"] + 0.15
    keyword_idx = pick_keyword(block)

    parts: list[str] = []
    for i, w in enumerate(block):
        rel_ms = int((w["start_sec"] - start) * 1000)
        color = NEON_YELLOW if i == keyword_idx else WHITE
        # Palavra invisível até seu timestamp, então pop-in de pop_scale% → 100%
        parts.append(
            f"{{\\c{color}\\alpha&HFF&\\t({rel_ms},{rel_ms},\\alpha&H00&\\fscx{pop_scale}\\fscy{pop_scale})"
            f"\\t({rel_ms},{rel_ms + 120},\\fscx100\\fscy100)}}{w['word'].upper()} "
        )

    text = "".join(parts).strip()
    return f"Dialogue: 0,{sec_to_ass_time(start)},{sec_to_ass_time(end)},Hormozi,,0,0,0,,{text}"


def generate_ass(transcript: dict, font: str, play_res: tuple[int, int], pop_scale: int) -> str:
    res_x, res_y = play_res
    header = f"""[Script Info]
Title: Hydra Creator captions
ScriptType: v4.00+
PlayResX: {res_x}
PlayResY: {res_y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hormozi,{font},{int(res_y * 0.045)},{WHITE},{WHITE},{OUTLINE_BLACK},&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,60,60,{int(res_y * 0.28)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    words = transcript.get("words", [])
    lines = [build_dialogue(block, pop_scale) for block in group_words(words)]
    return header + "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera legendas .ass Hormozi-style")
    parser.add_argument("transcript", help="transcript.json do analyzer")
    parser.add_argument("output", help="arquivo .ass de saída")
    parser.add_argument("--font", default="Montserrat")
    parser.add_argument("--play-res", default="1080x1920")
    parser.add_argument("--pop-scale", type=int, default=120)
    args = parser.parse_args()

    transcript = json.loads(Path(args.transcript).read_text(encoding="utf-8"))
    res_x, res_y = (int(v) for v in args.play_res.split("x"))
    ass = generate_ass(transcript, font=args.font, play_res=(res_x, res_y), pop_scale=args.pop_scale)
    Path(args.output).write_text(ass, encoding="utf-8")
    n_words = len(transcript.get("words", []))
    print(f"OK: {args.output} ({n_words} palavras)")


if __name__ == "__main__":
    main()
