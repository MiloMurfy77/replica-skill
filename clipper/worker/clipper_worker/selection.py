"""Elección de los mejores momentos de un vídeo largo.

- Con credenciales de Anthropic: Claude lee la transcripción (por frases numeradas) y
  devuelve rangos de frases + título, gancho, descripción, hashtags y puntuación.
- Sin credenciales: heurística local (densidad de habla, preguntas, cifras, frases completas).

En ambos casos los cortes caen en límites de frase, así ningún clip empieza o
termina a mitad de una palabra.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re

from . import config
from .asr import sentences

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior short-form video editor. You turn long videos (podcasts, interviews, talks, webinars) into standalone vertical clips for TikTok, Reels and YouTube Shorts.

You receive a transcript split into numbered lines, each with its start time in seconds. Pick the moments that work on their own for someone scrolling who has never seen the full video:
- The first line must hook within 3 seconds: a bold claim, a question, a surprising fact, a strong emotion, or the start of a story. Never start on filler ("so", "yeah", "um", "and then") or mid-thought.
- The clip must make sense without outside context, and the last line must land: a punchline, a conclusion, an answer. Never end mid-sentence or on a dangling setup.
- Prefer concrete stories, strong opinions, practical advice, humor, numbers, and contrarian takes. Avoid greetings, sponsor reads, housekeeping and outros.
- Clips must not overlap each other.

For each clip also write, in the language of the transcript:
- title: under 70 characters, curiosity-driven, no clickbait lies, no hashtags.
- hook: on-screen text for the first seconds, max 8 words, may differ from the spoken words.
- description: 1-2 sentences for the post caption.
- hashtags: 3-5 relevant hashtags without the # symbol.
- Scores from 0 to 99, judged honestly (most clips land between 40 and 85): hook_score (first 3 seconds), flow_score (coherent, complete arc), value_score (insight, emotion or entertainment), trend_score (topic appeal on short-form platforms right now), and score (overall virality potential).
- reason: one short sentence on why this moment works.

Order clips from best to worst."""

CLIP_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "title": {"type": "string"},
                    "hook": {"type": "string"},
                    "description": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "score": {"type": "integer"},
                    "hook_score": {"type": "integer"},
                    "flow_score": {"type": "integer"},
                    "value_score": {"type": "integer"},
                    "trend_score": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["start_line", "end_line", "title", "hook", "description", "hashtags", "score",
                             "hook_score", "flow_score", "value_score", "trend_score", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


def wanted_count(span_s: float, target_s: float) -> int:
    return int(min(40, max(3, round(span_s / (target_s * 2.2)))))


def claude_available() -> bool:
    if config.SELECTOR == "heuristic":
        return False
    if config.SELECTOR == "claude":
        return True
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def select_clips(words: list[dict], target_s: float, rng: tuple[float, float] | None,
                 prompt: str = "") -> tuple[list[dict], str]:
    lines = sentences(words)
    if rng:
        lines = [l for l in lines if l["s"] >= rng[0] - 0.01 and l["e"] <= rng[1] + 0.01]
    if not lines:
        return [], "none"
    span = lines[-1]["e"] - lines[0]["s"]
    n = wanted_count(span, target_s)
    if claude_available():
        try:
            raw = _claude(lines, target_s, n, prompt)
            return _finalize(raw, lines, target_s), "claude"
        except Exception as exc:  # noqa: BLE001 - la heurística es el plan B
            log.exception("Claude falló, uso la heurística: %s", exc)
    return _finalize(_heuristic(lines, target_s, n, prompt), lines, target_s), "heuristic"


# ---------------------------------------------------------------- Claude

def _claude(lines: list[dict], target_s: float, n: int, prompt: str) -> list[dict]:
    import anthropic

    client = anthropic.Anthropic()
    transcript = "\n".join(f"{i}\t[{l['s']:.1f}s]\t{l['text']}" for i, l in enumerate(lines))
    lo, hi = max(10, target_s * 0.5), target_s * 1.5
    ask = (
        f"Find up to {n} clips. Each clip should last between {lo:.0f} and {hi:.0f} seconds "
        f"(aim for about {target_s:.0f}s); a clip runs from the start time of start_line to the start "
        f"time of the line after end_line. Return fewer clips rather than weak ones."
    )
    if prompt.strip():
        ask += ("\n\nThe user is looking for specific moments. Only return clips that match this request "
                f"(return an empty list if nothing matches):\n<request>{prompt.strip()[:500]}</request>")

    with client.beta.messages.stream(
        model=config.CLAUDE_MODEL,
        max_tokens=32000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": CLIP_SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                # La transcripción va primero y se cachea: los reprompts sobre el mismo vídeo la reutilizan.
                {"type": "text", "text": f"<transcript>\n{transcript}\n</transcript>",
                 "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": ask},
            ],
        }],
    ) as stream:
        msg = stream.get_final_message()

    if msg.stop_reason == "refusal":
        raise RuntimeError("Claude rechazó la petición")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("respuesta truncada")
    text = next(b.text for b in msg.content if b.type == "text")
    data = json.loads(text)
    log.info("Claude: %s clips, uso %s", len(data["clips"]), msg.usage)
    return data["clips"]


# ---------------------------------------------------------------- heurística

FILLER_START = re.compile(r"^(so|and|but|um+|uh+|yeah|okay|ok|well|like|y|pues|bueno|eh+|este|o sea)\b[,.]?\s",
                          re.IGNORECASE)


def _line_score(text: str) -> float:
    s = 0.0
    if "?" in text:
        s += 1.2
    if "!" in text:
        s += 0.8
    if re.search(r"\d", text):
        s += 0.6
    if re.search(r"\b(never|always|most|best|worst|secret|mistake|nunca|siempre|mejor|peor|secreto|error)\b",
                 text, re.IGNORECASE):
        s += 0.7
    return s


def _heuristic(lines: list[dict], target_s: float, n: int, prompt: str) -> list[dict]:
    terms = [t for t in re.findall(r"\w{4,}", prompt.lower())] if prompt else []
    cands = []
    for i in range(len(lines)):
        if FILLER_START.match(lines[i]["text"]):
            continue
        for j in range(i, len(lines)):
            dur = lines[j]["e"] - lines[i]["s"]
            if dur > target_s * 1.5:
                break
            if dur < target_s * 0.6:
                continue
            seg = lines[i:j + 1]
            text = " ".join(l["text"] for l in seg)
            if terms and not any(t in text.lower() for t in terms):
                continue
            words = len(text.split())
            density = words / max(dur, 1)
            ends_clean = seg[-1]["text"][-1:] in ".?!"
            value = (sum(_line_score(l["text"]) for l in seg) / len(seg) * 2
                     + _line_score(seg[0]["text"]) * 1.5
                     + min(density, 3.5)
                     + (1.0 if ends_clean else 0)
                     - abs(dur - target_s) / target_s)
            cands.append((value, i, j))
    cands.sort(reverse=True)
    used: list[tuple[int, int]] = []
    picked = []
    for value, i, j in cands:
        if any(not (j < a or i > b) for a, b in used):
            continue
        used.append((i, j))
        picked.append((value, i, j))
        if len(picked) >= n:
            break
    if not picked:
        return []
    vmax = max(p[0] for p in picked)
    vmin = min(p[0] for p in picked)
    out = []
    for value, i, j in picked:
        norm = 0.5 if vmax == vmin else (value - vmin) / (vmax - vmin)
        score = int(45 + norm * 40)
        first = lines[i]["text"]
        title = first if len(first) <= 70 else first[:67].rsplit(" ", 1)[0] + "…"
        out.append({
            "start_line": i, "end_line": j, "title": title,
            "hook": " ".join(first.split()[:8]), "description": first,
            "hashtags": [], "score": score, "hook_score": score, "flow_score": score,
            "value_score": score, "trend_score": 50,
            "reason": "Elegido por la heurística local (sin IA): frases completas y habla densa.",
        })
    return out


# ---------------------------------------------------------------- validación

def _finalize(raw: list[dict], lines: list[dict], target_s: float) -> list[dict]:
    out: list[dict] = []
    taken: list[tuple[float, float]] = []
    n = len(lines)
    for c in raw:
        i, j = int(c["start_line"]), int(c["end_line"])
        if not (0 <= i < n) or not (0 <= j < n):
            continue
        if j < i:
            i, j = j, i
        start = lines[i]["s"]
        # termina justo antes de la siguiente frase (si no hay hueco grande) para no cortar la última palabra
        end = lines[j]["e"]
        if j + 1 < n:
            end = min(lines[j + 1]["s"], lines[j]["e"] + 0.6)
        else:
            end = lines[j]["e"] + 0.4
        start = max(0.0, start - 0.15)
        # recorta clips demasiado largos quitando frases del final
        while end - start > target_s * 1.8 and j > i:
            j -= 1
            end = lines[j]["e"] + 0.3
        if end - start < max(5.0, target_s * 0.3):
            continue
        if any(not (end <= a or start >= b) for a, b in taken):
            continue
        taken.append((start, end))

        def clamp(v):
            try:
                return int(max(0, min(99, int(v))))
            except (TypeError, ValueError):
                return 50

        out.append({
            "start_s": round(start, 3), "end_s": round(end, 3),
            "title": str(c.get("title", ""))[:120] or "Clip",
            "hook": str(c.get("hook", ""))[:80],
            "description": str(c.get("description", ""))[:600],
            "hashtags": [re.sub(r"[^\w]", "", str(h)).lower()[:40] for h in c.get("hashtags", [])][:6],
            "score": clamp(c.get("score")),
            "sub_scores": {k: clamp(c.get(f"{k}_score")) for k in ("hook", "flow", "value", "trend")},
            "reason": str(c.get("reason", ""))[:300],
        })
    out.sort(key=lambda c: -c["score"])
    return out


def minutes_for(span_s: float) -> int:
    return max(1, math.floor(span_s / 60))
