#!/usr/bin/env bash
#
# Hydra Creator — Motor de Transformação (FFmpeg chain anti-fingerprint).
#
# Aplica em ordem: crop dinâmico 9:16 + micro-zoom -> scale 1080x1920 ->
# color grading leve -> film grain -> legendas .ass ; e no áudio:
# pitch shift + speed + BGM ducking por VAD.
#
# Uso:
#   ./transform_chain.sh <input.mp4> <crop.json> <vad.json> <transcript.json> <output.mp4> \
#       [--bgm=path] [--use-cuda=auto|true|false] [--pitch=1.5] [--speed=2] \
#       [--grain=0.05] [--seed=42] [--font=Montserrat]
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 5 ]]; then
  echo "Uso: $0 <input> <crop.json> <vad.json> <transcript.json> <output.mp4> [flags]" >&2
  exit 2
fi

INPUT="$1"; CROP_JSON="$2"; VAD_JSON="$3"; TRANSCRIPT_JSON="$4"; OUTPUT="$5"
shift 5

BGM=""
USE_CUDA="auto"
PITCH="1.5"
SPEED="2"
GRAIN="0.05"
SEED=""
FONT="Montserrat"
LAYOUT="single"
SPLIT_CONFIG=""

for arg in "$@"; do
  case "$arg" in
    --bgm=*)          BGM="${arg#*=}" ;;
    --use-cuda=*)     USE_CUDA="${arg#*=}" ;;
    --pitch=*)        PITCH="${arg#*=}" ;;
    --speed=*)        SPEED="${arg#*=}" ;;
    --grain=*)        GRAIN="${arg#*=}" ;;
    --seed=*)         SEED="${arg#*=}" ;;
    --font=*)         FONT="${arg#*=}" ;;
    --layout=*)       LAYOUT="${arg#*=}" ;;
    --split-config=*) SPLIT_CONFIG="${arg#*=}" ;;
    *) echo "Flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python}"
WORK="$(mktemp -d -t hydra_transform_XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

command -v ffmpeg >/dev/null || { echo "ffmpeg não encontrado no PATH." >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe não encontrado no PATH." >&2; exit 1; }

OUT_W=1080
OUT_H=1920

# ---------------------------------------------------------------------------
# Detecção de GPU / encoder
# ---------------------------------------------------------------------------
detect_cuda() {
  if [[ "$USE_CUDA" == "false" ]]; then echo "cpu"; return; fi
  if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "h264_nvenc"; then
    if [[ "$USE_CUDA" == "true" ]] || command -v nvidia-smi >/dev/null 2>&1; then
      echo "cuda"; return
    fi
  fi
  echo "cpu"
}

ACCEL="$(detect_cuda)"
if [[ "$ACCEL" == "cuda" ]]; then
  VENCODER=(-c:v h264_nvenc -preset p4 -cq 20)
  RENDER_ENGINE="nvenc"
else
  VENCODER=(-c:v libx264 -preset medium -crf 20)
  RENDER_ENGINE="libx264"
fi
echo ">> Encoder de vídeo: $RENDER_ENGINE"

DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT")"
echo ">> Duração: ${DURATION}s"

# ---------------------------------------------------------------------------
# Detecção de filtro de pitch (rubberband preferível; fallback asetrate)
# ---------------------------------------------------------------------------
PITCH_RATIO="$(awk "BEGIN{printf \"%.5f\", 1 + $PITCH/100}")"
SPEED_RATIO="$(awk "BEGIN{printf \"%.5f\", 1 + $SPEED/100}")"

if ffmpeg -hide_banner -filters 2>/dev/null | grep -q "rubberband"; then
  PITCH_FILTER="rubberband=pitch=${PITCH_RATIO}"
  echo ">> Pitch shift via rubberband (${PITCH_RATIO}x)"
else
  # Fallback: altera sample rate (muda pitch) e reamostra de volta — depois corrige tempo
  SR="$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$INPUT" 2>/dev/null || echo 48000)"
  [[ -z "$SR" ]] && SR=48000
  NEW_SR="$(awk "BEGIN{printf \"%d\", $SR*$PITCH_RATIO}")"
  PITCH_FILTER="asetrate=${NEW_SR},aresample=${SR}"
  echo ">> Pitch shift via asetrate (fallback, sem rubberband)"
fi

# ---------------------------------------------------------------------------
# 1. Gerar expressões dinâmicas (crop/zoom + volume ducking) e legendas .ass
# ---------------------------------------------------------------------------
echo ">> Gerando filtros dinâmicos (layout=$LAYOUT)..."
SEED_ARG=()
[[ -n "$SEED" ]] && SEED_ARG=(--seed "$SEED")
LAYOUT_ARG=(--layout "$LAYOUT")
[[ "$LAYOUT" == "split" ]] && LAYOUT_ARG+=(--split-config "$SPLIT_CONFIG")
"$PYTHON" "$SCRIPT_DIR/generate_filters.py" \
  --crop "$CROP_JSON" --vad "$VAD_JSON" \
  --output-dir "$WORK" --duration "$DURATION" "${SEED_ARG[@]}" "${LAYOUT_ARG[@]}"

VOLUME_FILTER="$(cat "$WORK/volume_expr.txt")"

echo ">> Gerando legendas .ass..."
ASS_FILE="$WORK/captions.ass"
"$PYTHON" "$SCRIPT_DIR/generate_ass.py" "$TRANSCRIPT_JSON" "$ASS_FILE" \
  --font "$FONT" --play-res "${OUT_W}x${OUT_H}"

# libass lê o path de dentro do filtergraph (não é convertido pelo MSYS como os
# argumentos). Em Git Bash/Windows convertemos para path nativo via cygpath e
# escapamos ':' e '\' exigidos por libass.
if command -v cygpath >/dev/null 2>&1; then
  ASS_NATIVE="$(cygpath -m "$ASS_FILE")"
else
  ASS_NATIVE="$ASS_FILE"
fi
ASS_ESCAPED="$(echo "$ASS_NATIVE" | sed 's/\\/\//g; s/:/\\:/g')"

# ---------------------------------------------------------------------------
# 2. Montar filtergraph de vídeo
#    (crop 9:16 dinâmico | split cima/baixo) -> color grade -> grain -> legendas
# ---------------------------------------------------------------------------
GRAIN_ALPHA="$(awk "BEGIN{printf \"%.3f\", $GRAIN}")"
if [[ "$LAYOUT" == "split" ]]; then
  # generate_filters.py emitiu a cadeia completa terminando em [cropped]
  CROPPED_STAGE="$(cat "$WORK/split_expr.txt")"
else
  # crop dinâmico 9:16 -> scale para 1080x1920, saída [cropped]
  CROP_FILTER="$(cat "$WORK/crop_expr.txt")"
  CROPPED_STAGE="[0:v]${CROP_FILTER},scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1[cropped]"
fi
VIDEO_CHAIN="${CROPPED_STAGE};\
[cropped]eq=contrast=1.05:saturation=1.05:gamma=0.98[graded];\
[graded]noise=alls=12:allf=t+u,format=yuv420p[grained];\
[grained]ass='${ASS_ESCAPED}'[vout]"

# Nota: o film grain via `noise` acima aplica ~5% de ruído temporal. Para overlay de
# textura com opacidade exata, trocar por uma fonte de grain pré-renderizada + overlay.

# ---------------------------------------------------------------------------
# 3. Montar filtergraph de áudio + mux
# ---------------------------------------------------------------------------
if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$INPUT" | grep -q .; then
  VOICE_CHAIN="[0:a]${PITCH_FILTER},atempo=${SPEED_RATIO}[voice]"
  HAS_AUDIO=1
else
  VOICE_CHAIN=""
  HAS_AUDIO=0
  echo ">> Aviso: entrada sem áudio."
fi

FILTER_FILE="$WORK/filtergraph.txt"

if [[ -n "$BGM" && -f "$BGM" && "$HAS_AUDIO" == "1" ]]; then
  echo ">> BGM com ducking por VAD: $BGM"
  {
    echo "$VIDEO_CHAIN;"
    echo "$VOICE_CHAIN;"
    echo "[1:a]aloop=loop=-1:size=2e9,atrim=0:${DURATION},${VOLUME_FILTER}[bgm];"
    echo "[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
  } > "$FILTER_FILE"
  ffmpeg -y -hide_banner -loglevel warning \
    -i "$INPUT" -i "$BGM" \
    -filter_complex_script "$FILTER_FILE" \
    -map "[vout]" -map "[aout]" \
    "${VENCODER[@]}" -c:a aac -b:a 192k -movflags +faststart \
    "$OUTPUT"
elif [[ "$HAS_AUDIO" == "1" ]]; then
  echo ">> Sem BGM — apenas voz processada."
  { echo "$VIDEO_CHAIN;"; echo "$VOICE_CHAIN"; } > "$FILTER_FILE"
  ffmpeg -y -hide_banner -loglevel warning \
    -i "$INPUT" \
    -filter_complex_script "$FILTER_FILE" \
    -map "[vout]" -map "[voice]" \
    "${VENCODER[@]}" -c:a aac -b:a 192k -movflags +faststart \
    "$OUTPUT"
else
  echo "$VIDEO_CHAIN" > "$FILTER_FILE"
  ffmpeg -y -hide_banner -loglevel warning \
    -i "$INPUT" \
    -filter_complex_script "$FILTER_FILE" \
    -map "[vout]" \
    "${VENCODER[@]}" -movflags +faststart \
    "$OUTPUT"
fi

# ---------------------------------------------------------------------------
# 4. Registrar config efetiva (alimenta compliance.py)
# ---------------------------------------------------------------------------
CONFIG_OUT="$(dirname "$OUTPUT")/transformation_config_used.json"
cat > "$CONFIG_OUT" <<JSON
{
  "layout": "${LAYOUT}",
  "zoomMinScale": 1.0,
  "zoomMaxScale": 1.15,
  "zoomIntervalSec": 12.0,
  "grainOpacity": ${GRAIN_ALPHA},
  "colorGradeParams": {"contrast": 1.05, "saturation": 1.05, "gamma": 0.98},
  "pitchShiftPercent": ${PITCH},
  "speedPercent": ${SPEED},
  "bgmTrackUrl": $( [[ -n "$BGM" ]] && echo "\"$BGM\"" || echo null ),
  "bgmDuckSpeechLevel": 0.15,
  "bgmDuckSilenceLevel": 0.80,
  "bgmCrossfadeSec": 0.5,
  "captionStyle": {"fontFamily": "${FONT}", "highlightColor": "#FFF700", "popInScale": 1.2, "keywordHighlight": true},
  "renderEngine": "${RENDER_ENGINE}"
}
JSON

echo ">> Concluído: $OUTPUT"
echo ">> Config usada: $CONFIG_OUT"
