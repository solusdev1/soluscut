"""Smoke test do pipeline completo: analyzer -> transform_chain.sh -> compliance.

Uso:
    python scripts/run_pipeline_demo.py <video.mp4> [--bgm assets/bgm/sample_bgm.mp3]

Executado da raiz de backend/. Cria output/ com os artefatos de cada etapa.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TRANSFORM_DIR = BACKEND_ROOT / "app" / "transform"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"\n$ {' '.join(str(c) for c in cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipeline demo do Hydra Creator")
    parser.add_argument("video", help="Vídeo de entrada")
    parser.add_argument("--bgm", default=None, help="Trilha BGM opcional")
    parser.add_argument("--output-dir", default=str(BACKEND_ROOT / "output"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    out = Path(args.output_dir)
    analysis_dir = out / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    final_clip = out / "clip_final.mp4"

    # 1. Análise
    run([
        sys.executable, "-m", "app.analyzer.analyzer",
        "--input", args.video,
        "--output-dir", str(analysis_dir),
    ], cwd=BACKEND_ROOT)

    crop = analysis_dir / "crop_keyframes.json"
    vad = analysis_dir / "vad_segments.json"
    transcript = analysis_dir / "transcript.json"

    # 2. Transform chain
    sh_cmd = [
        "bash", str(TRANSFORM_DIR / "transform_chain.sh"),
        args.video, str(crop), str(vad), str(transcript), str(final_clip),
        f"--seed={args.seed}",
    ]
    if args.bgm:
        sh_cmd.append(f"--bgm={args.bgm}")
    run(sh_cmd, cwd=BACKEND_ROOT)

    config_used = final_clip.parent / "transformation_config_used.json"

    # 3. Compliance
    result = run([
        sys.executable, "-m", "app.compliance.compliance",
        "--crop", str(crop),
        "--vad", str(vad),
        "--transcript", str(transcript),
        "--config", str(config_used),
        "--out", str(out / "compliance_score.json"),
    ], cwd=BACKEND_ROOT, capture_output=True, text=True)
    print(result.stdout)

    score = json.loads((out / "compliance_score.json").read_text(encoding="utf-8"))
    print(f"\n=== Pipeline concluído ===")
    print(f"Clipe:      {final_clip}")
    print(f"Score:      {score['overall_score']} (passou: {score['passed_threshold']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
