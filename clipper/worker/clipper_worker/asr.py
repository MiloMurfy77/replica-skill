"""Transcripción con marcas de tiempo por palabra.

Devuelve (idioma, palabras) con palabras = [{"w": str, "s": float, "e": float, "sp": int}].
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import requests

from . import config

_whisper_model = None


def transcribe(audio: Path, duration: float, on_progress: Callable[[float], None]) -> tuple[str, list[dict], str]:
    if config.ASR_PROVIDER == "deepgram" and config.DEEPGRAM_API_KEY:
        lang, words = _deepgram(audio)
        on_progress(1.0)
        return lang, words, "deepgram"
    lang, words = _whisper(audio, duration, on_progress)
    return lang, words, f"whisper-{config.WHISPER_MODEL}"


def _whisper(audio: Path, duration: float, on_progress) -> tuple[str, list[dict]]:
    global _whisper_model
    from faster_whisper import WhisperModel

    if _whisper_model is None:
        _whisper_model = WhisperModel(config.WHISPER_MODEL, device="auto", compute_type="int8",
                                      download_root=str(config.MODELS_DIR / "whisper"))
    # leemos el WAV (16 kHz mono, generado por ffmpeg) nosotros mismos: evita depender de PyAV
    import wave

    import numpy as np

    with wave.open(str(audio), "rb") as wf:
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), np.int16).astype(np.float32) / 32768.0
    segments, info = _whisper_model.transcribe(
        pcm, word_timestamps=True, vad_filter=True, beam_size=1,
        condition_on_previous_text=False,
    )
    words: list[dict] = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"w": text, "s": round(w.start, 3), "e": round(w.end, 3), "sp": 0})
        if duration:
            on_progress(min(1.0, seg.end / duration))
    return info.language, words


def _deepgram(audio: Path) -> tuple[str, list[dict]]:
    with open(audio, "rb") as fh:
        resp = requests.post(
            "https://api.deepgram.com/v1/listen",
            params={"model": "nova-3", "smart_format": "true", "punctuate": "true",
                    "diarize": "true", "detect_language": "true"},
            headers={"Authorization": f"Token {config.DEEPGRAM_API_KEY}", "Content-Type": "audio/wav"},
            data=fh, timeout=1800,
        )
    resp.raise_for_status()
    ch = resp.json()["results"]["channels"][0]
    alt = ch["alternatives"][0]
    words = [
        {"w": w.get("punctuated_word") or w["word"], "s": round(w["start"], 3), "e": round(w["end"], 3),
         "sp": int(w.get("speaker", 0))}
        for w in alt.get("words", [])
    ]
    return ch.get("detected_language", "en"), words


def sentences(words: list[dict], max_words: int = 40, gap: float = 0.9) -> list[dict]:
    """Agrupa palabras en frases: corta en puntuación final, pausa larga o tamaño máximo."""
    out: list[dict] = []
    cur: list[int] = []
    for i, w in enumerate(words):
        if cur and (w["s"] - words[cur[-1]]["e"] > gap or len(cur) >= max_words):
            out.append(_mk(words, cur))
            cur = []
        cur.append(i)
        if w["w"][-1:] in ".?!…" and len(cur) >= 3:
            out.append(_mk(words, cur))
            cur = []
    if cur:
        out.append(_mk(words, cur))
    return out


def _mk(words, idx):
    return {
        "i0": idx[0], "i1": idx[-1],
        "s": words[idx[0]]["s"], "e": words[idx[-1]]["e"],
        "text": " ".join(words[i]["w"] for i in idx),
    }
