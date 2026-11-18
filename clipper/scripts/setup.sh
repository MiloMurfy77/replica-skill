#!/usr/bin/env bash
# Instala dependencias del worker y de la web, y descarga el detector de caras.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v ffmpeg >/dev/null || { echo "Falta ffmpeg (apt-get install -y ffmpeg)"; exit 1; }
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r worker/requirements.txt
mkdir -p worker/models
[ -s worker/models/yunet.onnx ] || curl -fsSL -o worker/models/yunet.onnx \
  https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx
(cd web && pnpm install --frozen-lockfile)
echo "Listo. Siguiente: scripts/dev-db.sh, luego scripts/dev.sh"
