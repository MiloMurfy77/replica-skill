"""Composición y render de un clip: recorte, subtítulos animados y gancho."""
from __future__ import annotations

import tempfile
from pathlib import Path

from . import config
from .media import run, threads_args

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}

# Estilos propios (no copian los presets de nadie). Colores ASS: &HAABBGGRR
CAPTION_STYLES = {
    "impacto": dict(font="Inter Black", size=0.072, upper=True, primary="&H00FFFFFF", active="&H0000E5FF",
                    outline=6, shadow=0, words=3, pop=True, margin=0.30),
    "karaoke": dict(font="Inter ExtraBold", size=0.062, upper=False, primary="&H00FFFFFF", active="&H0066FF33",
                    outline=4, shadow=2, words=4, pop=False, margin=0.28),
    "minimal": dict(font="Inter SemiBold", size=0.048, upper=False, primary="&H00FFFFFF", active=None,
                    outline=2, shadow=3, words=7, pop=False, margin=0.12),
}


def _ts(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _esc(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def chunk_words(words: list[dict], max_words: int) -> list[list[dict]]:
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        brk = (
            len(cur) >= max_words
            or w["w"][-1:] in ".?!,;:…"
            or (nxt is not None and nxt["s"] - w["e"] > 0.5)
        )
        if brk:
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks


def build_ass(words: list[dict], style_name: str, size: tuple[int, int], duration: float,
              hook: str = "", layout: str = "fill") -> str:
    """words: tiempos relativos al inicio del clip."""
    W, H = size
    st = CAPTION_STYLES.get(style_name)
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    if st:
        fs = int(H * st["size"]) if W < H else int(H * st["size"] * 1.25)
        # en "fit" el vídeo ocupa la franja central: los subtítulos van debajo
        mv = int(H * (0.18 if layout == "fit" and W < H else st["margin"]))
        lines.append(
            f"Style: Cap,{st['font']},{fs},{st['primary']},&H000000FF,&H00000000,&H80000000,"
            f"0,0,0,0,100,100,0,0,1,{st['outline']},{st['shadow']},2,60,60,{mv},1"
        )
    lines.append(
        f"Style: Hook,Inter ExtraBold,{int(min(W, H) * 0.055)},&H00111111,&H000000FF,&H00FFFFFF,&H00FFFFFF,"
        f"0,0,0,0,100,100,0,0,3,18,0,8,80,80,{int(H * 0.12)},1"
    )
    lines += ["", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]

    if hook:
        lines.append(f"Dialogue: 1,{_ts(0)},{_ts(min(3.5, duration))},Hook,,0,0,0,,{{\\fad(150,250)}}{_esc(hook)}")

    if st:
        chunks = chunk_words(words, st["words"])
        floor = 0.0  # nunca dos subtítulos a la vez: cada evento empieza donde acabó el anterior
        for ci, chunk in enumerate(chunks):
            texts = [_esc(w["w"].upper() if st["upper"] else w["w"]) for w in chunk]
            c_end = min(duration, chunk[-1]["e"] + 0.15)
            if ci + 1 < len(chunks):
                c_end = min(c_end, chunks[ci + 1][0]["s"])
            c_start = max(chunk[0]["s"], floor)
            if c_end <= c_start:
                continue
            if st["active"] is None:
                lines.append(f"Dialogue: 0,{_ts(c_start)},{_ts(c_end)},Cap,,0,0,0,,{' '.join(texts)}")
                floor = c_end
                continue
            for j, w in enumerate(chunk):
                s = max(w["s"] if j else c_start, floor)
                e = min(chunk[j + 1]["s"], c_end) if j + 1 < len(chunk) else c_end
                if e - s < 0.01:
                    continue
                floor = e
                parts = []
                for k, t in enumerate(texts):
                    if k == j:
                        pop = "\\t(0,90,\\fscx112\\fscy112)\\t(90,180,\\fscx106\\fscy106)" if st["pop"] else ""
                        parts.append(f"{{\\c{st['active']}{pop}}}{t}{{\\r}}")
                    else:
                        parts.append(t)
                lines.append(f"Dialogue: 0,{_ts(s)},{_ts(e)},Cap,,0,0,0,,{' '.join(parts)}")
    return "\n".join(lines) + "\n"


def _crop_x_expr(keys: list[dict], crop_w: int, src_w: int) -> str:
    """Expresión por tramos para la x del recorte (cortes limpios en cada cambio)."""
    xs = [int(round(min(max(k["cx"] * src_w - crop_w / 2, 0), src_w - crop_w))) for k in keys]
    expr = str(xs[-1])
    for k, x in zip(reversed(keys[1:]), reversed(xs[:-1])):
        expr = f"if(lt(t,{k['t']:.3f}),{x},{expr})"
    return expr


def render_clip(src: Path, src_w: int, src_h: int, start: float, end: float, words: list[dict],
                edit: dict, out: Path, preview: bool = False) -> None:
    aspect = edit.get("aspect", "9:16")
    W, H = ASPECTS.get(aspect, ASPECTS["9:16"])
    if preview:
        W, H = W // 2, H // 2
    duration = end - start
    layout = edit.get("layout", "fill")
    keys = edit.get("crop") or [{"t": 0.0, "cx": 0.5}]
    out_aspect = W / H

    rel_words = [
        {"w": w["w"], "s": max(0.0, w["s"] - start), "e": min(duration, w["e"] - start)}
        for w in words if w["e"] > start and w["s"] < end
    ]
    ass = build_ass(rel_words, edit.get("caption_style", "impacto"), (W, H), duration,
                    edit.get("hook", "") if edit.get("show_hook", True) else "", layout)

    with tempfile.TemporaryDirectory() as td:
        ass_path = Path(td) / "c.ass"
        ass_path.write_text(ass, encoding="utf-8")
        subs = f"subtitles=filename={ass_path}:fontsdir={config.FONTS_DIR}"
        if layout == "fill" and out_aspect < src_w / src_h:
            crop_w = int(src_h * out_aspect) // 2 * 2
            xexpr = _crop_x_expr(keys, crop_w, src_w)
            graph = (f"[0:v]crop=w={crop_w}:h={src_h // 2 * 2}:x='{xexpr}':y=0,"
                     f"scale={W}:{H}:flags=lanczos,setsar=1,{subs}[v]")
        else:
            graph = (f"[0:v]split[a][b];"
                     f"[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2,"
                     f"eq=brightness=-0.08[bg];"
                     f"[b]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
                     f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,{subs}[v]")
        graph_file = Path(td) / "g.txt"
        graph_file.write_text(graph, encoding="utf-8")
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp_out = out.with_suffix(".tmp.mp4")
        run([
            "ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(src),
            "-filter_complex_script", str(graph_file), "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast" if preview else "fast",
            "-crf", "28" if preview else "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k" if preview else "160k", "-ar", "48000",
            "-movflags", "+faststart", *threads_args(), str(tmp_out),
        ])
        tmp_out.replace(out)


def srt(words: list[dict], start: float, end: float) -> str:
    rel = [{"w": w["w"], "s": w["s"] - start, "e": w["e"] - start} for w in words if w["e"] > start and w["s"] < end]

    def f(t):
        t = max(0.0, t)
        ms = int(round(t * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    out = []
    for i, ch in enumerate(chunk_words(rel, 7), 1):
        out.append(f"{i}\n{f(ch[0]['s'])} --> {f(ch[-1]['e'])}\n{' '.join(w['w'] for w in ch)}\n")
    return "\n".join(out)
