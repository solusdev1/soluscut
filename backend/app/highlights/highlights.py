"""Detecção de melhores momentos (highlights) com pontuação.

Combina quatro sinais já produzidos pelo analyzer:
  - transcript.json  → texto (padrões de gancho), ritmo de fala, confiança
  - vad_segments.json→ densidade de fala na janela
  - áudio WAV 16kHz  → energia RMS (picos de empolgação/risada/grito)
  - duração alvo     → janelas alinhadas a fronteiras de frase

Saída: lista de highlights ordenada por score (0–100), cada um com título,
motivo em pt-BR e o breakdown por componente — pronto para a tela
"Clipes sugeridos pela IA" do frontend.

Uso CLI:
    python -m app.highlights.highlights --transcript t.json --vad v.json \
        --audio audio.wav --duration 300 --min-dur 15 --max-dur 60
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import wave
from pathlib import Path

logger = logging.getLogger("hydra.highlights")

# Pesos dos componentes do score final (somam 1.0).
WEIGHTS = {
    "hook": 0.25,
    "speech": 0.20,
    "energy": 0.20,
    "pace": 0.15,
    "confidence": 0.10,
    "completeness": 0.10,
}

# Padrões de "gancho" (pt-BR + en) avaliados nas primeiras palavras da janela.
HOOK_PATTERNS = [
    (r"\?", 1.5),                                                   # pergunta direta
    (r"\b\d[\d.,]*\b", 1.0),                                        # números concretos
    (r"\b(como|why|how|por\s*qu[eê]|porque)\b", 1.2),
    (r"\b(segredo|secret|truque|trick|dica|hack)\b", 1.3),
    (r"\b(nunca|jamais|never|sempre|always|ningu[eé]m|nobody)\b", 1.0),
    (r"\b(erro|errado|mistake|wrong|cuidado|warning|perigo)\b", 1.2),
    (r"\b(voc[eê]|vc|you|te|sua|seu)\b", 0.8),
    (r"\b(dinheiro|money|gr[aá]tis|free|mil|milh[aã]o|million)\b", 1.1),
    (r"\b(olha|veja|escuta|listen|look|aten[cç][aã]o|imagina)\b", 1.0),
    (r"\b(incr[ií]vel|insano|absurdo|crazy|insane|chocante|shocking)\b", 1.1),
    (r"\b(melhor|pior|best|worst|maior|top)\b", 0.9),
    (r"\b(n[aã]o\s+fa[cç]a|pare|stop|don'?t)\b", 1.2),
]

SENTENCE_END = re.compile(r"[.!?…]\s*$")

# Energia RMS: janelas de análise do WAV (s) e percentil de normalização.
ENERGY_WIN_SEC = 0.5
ENERGY_NORM_PCT = 95


# ---------------------------------------------------------------------------
# Energia de áudio
# ---------------------------------------------------------------------------

def compute_energy_profile(audio_wav_path: str) -> tuple[list[float], float]:
    """RMS normalizado por janela de ENERGY_WIN_SEC. Retorna (perfil, win_sec).

    Espera WAV PCM16 mono (o mesmo extraído para VAD/Whisper). Erros são
    tolerados: perfil vazio faz o componente de energia virar neutro (0.5).
    """
    import numpy as np

    try:
        with wave.open(audio_wav_path, "rb") as wf:
            sr = wf.getframerate()
            n = wf.getnframes()
            raw = wf.readframes(n)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as exc:  # noqa: BLE001 — energia é sinal opcional
        logger.warning("Falha ao ler WAV para energia (%s); componente neutro.", exc)
        return [], ENERGY_WIN_SEC

    win = max(1, int(sr * ENERGY_WIN_SEC))
    n_win = max(1, len(samples) // win)
    rms = [float(np.sqrt(np.mean(samples[i * win : (i + 1) * win] ** 2))) for i in range(n_win)]
    if not rms:
        return [], ENERGY_WIN_SEC

    norm = float(np.percentile(rms, ENERGY_NORM_PCT)) or 1e-6
    return [min(1.0, v / norm) for v in rms], ENERGY_WIN_SEC


def _window_energy(profile: list[float], win_sec: float, start: float, end: float) -> float:
    if not profile:
        return 0.5  # neutro quando não há áudio/perfil
    i0 = max(0, int(start / win_sec))
    i1 = min(len(profile), max(i0 + 1, int(end / win_sec)))
    chunk = profile[i0:i1]
    return sum(chunk) / len(chunk) if chunk else 0.5


# ---------------------------------------------------------------------------
# Componentes de score
# ---------------------------------------------------------------------------

def _hook_score(text: str) -> float:
    """Avalia padrões de gancho nas primeiras ~12 palavras (0–1)."""
    head = " ".join(text.split()[:12]).lower()
    total = sum(weight for pattern, weight in HOOK_PATTERNS if re.search(pattern, head))
    return min(1.0, total / 3.0)


def _speech_ratio(vad_segments: list[dict], start: float, end: float) -> float:
    dur = max(1e-6, end - start)
    speech = 0.0
    for seg in vad_segments:
        if not seg["is_speech"]:
            continue
        speech += max(0.0, min(end, seg["end_sec"]) - max(start, seg["start_sec"]))
    return min(1.0, speech / dur)


def _pace_score(n_words: int, dur: float) -> float:
    """Palavras/s: pico em ~2.7 wps (ritmo de short viral), decai fora da faixa."""
    wps = n_words / max(1e-6, dur)
    if wps <= 0.5:
        return 0.0
    return max(0.0, min(1.0, 1.0 - abs(wps - 2.7) / 2.2))


def _completeness_score(first_seg: dict, last_seg: dict) -> float:
    score = 0.5
    if SENTENCE_END.search(last_seg["text"].strip()):
        score += 0.5  # termina em fim de frase — corte "fecha" a ideia
    return min(1.0, score)


# ---------------------------------------------------------------------------
# Geração e ranking de candidatos
# ---------------------------------------------------------------------------

def _build_candidates(segments: list[dict], min_dur: float, max_dur: float) -> list[tuple[int, int]]:
    """Pares (i, j) de índices de segmento cujo intervalo cabe em [min_dur, max_dur]."""
    candidates: list[tuple[int, int]] = []
    for i in range(len(segments)):
        start = segments[i]["start_sec"]
        for j in range(i, len(segments)):
            dur = segments[j]["end_sec"] - start
            if dur > max_dur:
                break
            if dur >= min_dur:
                candidates.append((i, j))
    return candidates


def _overlap_ratio(a: dict, b: dict) -> float:
    inter = max(0.0, min(a["end_sec"], b["end_sec"]) - max(a["start_sec"], b["start_sec"]))
    shorter = max(1e-6, min(a["end_sec"] - a["start_sec"], b["end_sec"] - b["start_sec"]))
    return inter / shorter


def _reason_pt(breakdown: dict) -> str:
    labels = {
        "hook": "gancho forte na abertura",
        "speech": "fala contínua sem tempo morto",
        "energy": "alta energia no áudio",
        "pace": "ritmo de fala ideal para shorts",
        "confidence": "transcrição de alta confiança",
        "completeness": "ideia completa (começo e fim de frase)",
    }
    top = sorted(breakdown.items(), key=lambda kv: kv[1] * WEIGHTS[kv[0]], reverse=True)[:2]
    return "Trecho com " + " e ".join(labels[k] for k, _ in top) + "."


def _title_from_text(text: str, max_words: int = 8) -> str:
    words = text.split()
    title = " ".join(words[:max_words]).strip(" ,;:-")
    return (title + "…") if len(words) > max_words else title


def detect_highlights(
    transcript: dict,
    vad: dict,
    audio_wav_path: str | None,
    duration_sec: float,
    min_dur: float = 15.0,
    max_dur: float = 60.0,
    top_n: int = 6,
    lead_in_sec: float = 0.25,
    lead_out_sec: float = 0.45,
) -> dict:
    """Retorna {"highlights": [...]} ordenado por score decrescente.

    Cada highlight: id, start_sec, end_sec, duration_sec, score (0–100),
    breakdown por componente, title, reason e text (transcrição do trecho).
    """
    segments = transcript.get("segments", [])
    vad_segments = vad.get("segments", [])
    profile, win_sec = compute_energy_profile(audio_wav_path) if audio_wav_path else ([], ENERGY_WIN_SEC)

    # Vídeo curto demais para janela mínima: o vídeo inteiro é o único candidato.
    if duration_sec <= min_dur:
        min_dur = max(3.0, duration_sec * 0.6)

    scored: list[dict] = []

    if segments:
        for i, j in _build_candidates(segments, min_dur, max_dur):
            window = segments[i : j + 1]
            start = max(0.0, window[0]["start_sec"] - lead_in_sec)
            end = min(duration_sec, window[-1]["end_sec"] + lead_out_sec)
            dur = end - start
            text = " ".join(seg["text"].strip() for seg in window)
            words = [w for seg in window for w in seg.get("words", [])]

            breakdown = {
                "hook": _hook_score(text),
                "speech": _speech_ratio(vad_segments, start, end),
                "energy": _window_energy(profile, win_sec, start, end),
                "pace": _pace_score(len(words), dur),
                "confidence": (
                    sum(w["confidence"] for w in words) / len(words) if words else 0.5
                ),
                "completeness": _completeness_score(window[0], window[-1]),
            }
            score = sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS) * 100.0
            scored.append(
                {
                    "start_sec": round(start, 3),
                    "end_sec": round(end, 3),
                    "duration_sec": round(dur, 3),
                    "score": round(score, 1),
                    "breakdown": {k: round(v, 3) for k, v in breakdown.items()},
                    "title": _title_from_text(text) or "Momento de fala",
                    "reason": _reason_pt(breakdown),
                    "text": text,
                }
            )
    else:
        # Sem fala: janelas fixas ranqueadas só por energia (gameplay, música).
        step = max(min_dur / 2, 5.0)
        t = 0.0
        while t + min_dur <= duration_sec or (t == 0.0 and duration_sec > 0):
            end = min(duration_sec, t + min_dur)
            energy = _window_energy(profile, win_sec, t, end)
            scored.append(
                {
                    "start_sec": round(t, 3),
                    "end_sec": round(end, 3),
                    "duration_sec": round(end - t, 3),
                    "score": round(energy * 70.0, 1),  # teto menor: sem fala não há gancho
                    "breakdown": {"energy": round(energy, 3)},
                    "title": "Momento de alta atividade",
                    "reason": "Trecho com alta energia no áudio (sem fala detectada).",
                    "text": "",
                }
            )
            t += step

    # Non-max suppression: descarta janelas muito sobrepostas a uma melhor.
    scored.sort(key=lambda h: h["score"], reverse=True)
    kept: list[dict] = []
    for cand in scored:
        if all(_overlap_ratio(cand, k) < 0.4 for k in kept):
            kept.append(cand)
        if len(kept) >= top_n:
            break

    kept.sort(key=lambda h: h["score"], reverse=True)
    for idx, h in enumerate(kept):
        h["id"] = f"hl_{idx + 1:02d}"

    return {"highlights": kept}


def main() -> None:
    parser = argparse.ArgumentParser(description="Hydra Creator — detecção de highlights")
    parser.add_argument("--transcript", required=True)
    parser.add_argument("--vad", required=True)
    parser.add_argument("--audio", default=None, help="WAV 16kHz mono (opcional, para energia)")
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--min-dur", type=float, default=15.0)
    parser.add_argument("--max-dur", type=float, default=60.0)
    parser.add_argument("--top", type=int, default=6)
    parser.add_argument("--output", default=None, help="Arquivo de saída (default: stdout)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    result = detect_highlights(
        transcript=json.loads(Path(args.transcript).read_text(encoding="utf-8")),
        vad=json.loads(Path(args.vad).read_text(encoding="utf-8")),
        audio_wav_path=args.audio,
        duration_sec=args.duration,
        min_dur=args.min_dur,
        max_dur=args.max_dur,
        top_n=args.top,
    )
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")
        print(f"OK: {args.output} ({len(result['highlights'])} highlights)")
    else:
        print(payload)


if __name__ == "__main__":
    main()
