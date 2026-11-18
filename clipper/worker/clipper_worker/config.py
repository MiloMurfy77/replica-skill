"""Configuración del worker, leída del entorno."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://clipper@localhost:5433/clipper")
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", ROOT.parent / ".data" / "storage")).resolve()
FONTS_DIR = Path(os.environ.get("FONTS_DIR", ROOT / "fonts")).resolve()
MODELS_DIR = Path(os.environ.get("MODELS_DIR", ROOT / "models")).resolve()

# Transcripción: "whisper" (local) o "deepgram" (API)
ASR_PROVIDER = os.environ.get("ASR_PROVIDER", "whisper")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")

# Selección de clips: Claude si hay credenciales, si no heurística local
SELECTOR = os.environ.get("CLIP_SELECTOR", "auto")  # auto | claude | heuristic
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")

# Límites
MAX_SOURCE_SECONDS = int(os.environ.get("MAX_SOURCE_SECONDS", 3 * 3600))
MAX_DOWNLOAD_BYTES = int(os.environ.get("MAX_DOWNLOAD_BYTES", 4 * 1024**3))
FFMPEG_THREADS = os.environ.get("FFMPEG_THREADS", "0")


def path_in_storage(rel: str) -> Path:
    p = (STORAGE_DIR / rel).resolve()
    if STORAGE_DIR not in p.parents and p != STORAGE_DIR:
        raise ValueError("ruta fuera del almacenamiento")
    return p
