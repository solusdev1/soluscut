"""Compliance Scanner — score de originalidade (Gatekeeper pré-export).

Consome os JSONs de análise + a config de transformação efetivamente aplicada e
produz um score 0–100 com breakdown. O objetivo é educar o usuário sobre por que
certas edições reduzem o risco de flag de "Conteúdo Reutilizado" — NÃO é garantia
de que reutilizar conteúdo de terceiros sem permissão seja lícito.

Uso:
    python -m app.compliance.compliance --crop crop.json --vad vad.json \
        --transcript transcript.json --config transformation_config_used.json
"""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

WEIGHTS = {
    "crop_variation_score": 0.25,
    "audio_shift_score": 0.20,
    "visual_effects_score": 0.20,
    "bgm_score": 0.15,
    "caption_coverage_score": 0.20,
}
PASS_THRESHOLD = 70.0


@dataclass
class ComplianceResult:
    overall_score: float
    breakdown: dict[str, float]
    weights: dict[str, float]
    passed_threshold: bool
    notes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def score_crop_variation(crop_data: dict) -> tuple[float, str]:
    """Movimento orgânico do crop pontua alto; estático ou errático é penalizado."""
    kfs = crop_data.get("keyframes", [])
    if len(kfs) < 2:
        return 0.0, "Crop estático (1 keyframe) — alto risco de fingerprint visual."

    src_w = crop_data.get("source_width", 1920)
    centers = [kf["x"] + kf["w"] / 2 for kf in kfs]
    deltas = [abs(centers[i + 1] - centers[i]) for i in range(len(centers) - 1)]
    mean_delta = statistics.mean(deltas)
    # Normaliza o deslocamento médio como fração da largura do frame.
    frac = mean_delta / src_w

    if frac < 0.002:
        return 20.0, "Crop praticamente estático — pouca diferenciação do original."
    # Faixa ideal ~1–8% de deslocamento médio; acima disso vira movimento errático.
    if frac <= 0.08:
        return _clamp(100 * (frac / 0.08) ** 0.6), "Movimento de crop orgânico."
    penalty = _clamp(100 - (frac - 0.08) * 400)
    return penalty, "Crop muito errático — risco de rejeição algorítmica (movimento robótico)."


def score_audio_shift(config: dict) -> tuple[float, str]:
    """Pitch (ideal 1–2%) e speed (ideal 1–3%) presentes e dentro da faixa."""
    pitch = abs(float(config.get("pitchShiftPercent", 0) or 0))
    speed = abs(float(config.get("speedPercent", 0) or 0))

    def band(v: float, lo: float, hi: float) -> float:
        if v == 0:
            return 0.0
        if lo <= v <= hi:
            return 100.0
        if v < lo:
            return _clamp(100 * v / lo)
        return _clamp(100 - (v - hi) * 20)  # penaliza excesso (audível)

    pitch_s = band(pitch, 1.0, 2.0)
    speed_s = band(speed, 1.0, 3.0)
    score = 0.5 * pitch_s + 0.5 * speed_s
    if score == 0:
        return 0.0, "Sem pitch/speed shift — fingerprint de áudio idêntico ao source."
    return score, f"Pitch {pitch:.1f}% / speed {speed:.1f}%."


def score_visual_effects(config: dict) -> tuple[float, str]:
    """Grain (3–7%) + color grading != identidade, cada um 50% do sub-score."""
    grain = float(config.get("grainOpacity", 0) or 0)
    if grain == 0:
        grain_s = 0.0
    elif 0.03 <= grain <= 0.07:
        grain_s = 100.0
    else:
        grain_s = _clamp(100 - abs(grain - 0.05) * 1000)

    cg = config.get("colorGradeParams") or {}
    identity = {"contrast": 1.0, "saturation": 1.0, "gamma": 1.0}
    deviation = sum(abs(float(cg.get(k, 1.0)) - v) for k, v in identity.items())
    color_s = _clamp(deviation * 500)  # ~0.2 de desvio total já satura em 100

    score = 0.5 * grain_s + 0.5 * color_s
    notes = []
    if grain_s < 50:
        notes.append("grain fora da faixa 3–7%")
    if color_s < 50:
        notes.append("color grading fraco/ausente")
    return score, "; ".join(notes) if notes else "Efeitos visuais aplicados."


def score_bgm(config: dict) -> tuple[float, str]:
    """BGM presente com ducking configurado corretamente."""
    if not config.get("bgmTrackUrl"):
        return 0.0, "Sem BGM — camada de áudio transformativa ausente."
    speech = float(config.get("bgmDuckSpeechLevel", 0) or 0)
    silence = float(config.get("bgmDuckSilenceLevel", 0) or 0)
    crossfade = float(config.get("bgmCrossfadeSec", 0) or 0)
    ok = speech < silence and crossfade > 0 and 0 < speech <= 0.3 and silence >= 0.5
    return (100.0, "BGM com ducking configurado.") if ok else (60.0, "BGM presente, ducking subótimo.")


def score_caption_coverage(vad_data: dict, transcript_data: dict) -> tuple[float, str]:
    """% do tempo de fala (VAD) coberto por palavras transcritas."""
    speech_segments = [s for s in vad_data.get("segments", []) if s.get("is_speech")]
    total_speech = sum(s["end_sec"] - s["start_sec"] for s in speech_segments)
    if total_speech <= 0:
        # Sem fala: legenda não se aplica; não penaliza (score neutro alto).
        return 100.0, "Sem fala detectada — cobertura de legenda não aplicável."

    words = transcript_data.get("words", [])
    if not words:
        return 0.0, "Há fala, mas nenhuma legenda gerada."

    covered = sum(w["end_sec"] - w["start_sec"] for w in words)
    ratio = min(1.0, covered / total_speech)
    return _clamp(ratio * 100), f"Legendas cobrem {ratio * 100:.0f}% da fala."


def compute_compliance_score(
    crop_keyframes: dict,
    vad_segments: dict,
    transcript: dict,
    transformation_config: dict,
) -> ComplianceResult:
    subs: dict[str, float] = {}
    notes: list[str] = []

    for key, (score, note) in {
        "crop_variation_score": score_crop_variation(crop_keyframes),
        "audio_shift_score": score_audio_shift(transformation_config),
        "visual_effects_score": score_visual_effects(transformation_config),
        "bgm_score": score_bgm(transformation_config),
        "caption_coverage_score": score_caption_coverage(vad_segments, transcript),
    }.items():
        subs[key] = round(score, 1)
        notes.append(f"{key}: {note}")

    overall = round(sum(subs[k] * WEIGHTS[k] for k in WEIGHTS), 1)
    return ComplianceResult(
        overall_score=overall,
        breakdown=subs,
        weights=WEIGHTS,
        passed_threshold=overall >= PASS_THRESHOLD,
        notes=notes,
    )


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hydra Creator — compliance scoring")
    parser.add_argument("--crop", required=True)
    parser.add_argument("--vad", required=True)
    parser.add_argument("--transcript", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", default=None, help="Grava o resultado JSON neste path (opcional)")
    args = parser.parse_args(argv)

    result = compute_compliance_score(
        _load(args.crop), _load(args.vad), _load(args.transcript), _load(args.config)
    )
    payload = json.dumps(result.to_dict(), indent=2, ensure_ascii=False)
    print(payload)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")

    return 0 if result.passed_threshold else 3  # exit 3 = abaixo do threshold


if __name__ == "__main__":
    raise SystemExit(main())
