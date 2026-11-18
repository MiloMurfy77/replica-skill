"""Bucle del worker: toma tareas de Postgres y las ejecuta.

    python -m clipper_worker.main            # corre para siempre
    python -m clipper_worker.main --once     # procesa lo pendiente y sale (tests)
"""
from __future__ import annotations

import argparse
import ipaddress
import logging
import select as _select
import shutil
import socket
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import requests
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import asr, config, framing, media, render
from .selection import minutes_for, select_clips

log = logging.getLogger("clipper")

PICK_SQL = """
update tasks set status='running', attempts=attempts+1, locked_until=now() + interval '45 minutes'
where id = (
  select id from tasks
  where (status='queued' and run_after <= now())
     or (status='running' and locked_until < now() and attempts < max_attempts)
  order by id for update skip locked limit 1)
returning *
"""


def connect() -> psycopg.Connection:
    return psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row)


class Ctx:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def q(self, sql: str, *args):
        return self.conn.execute(sql, args)

    def one(self, sql: str, *args):
        return self.conn.execute(sql, args).fetchone()


# ------------------------------------------------------------------ ingest

def _safe_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        raise ValueError("Solo se aceptan enlaces https.")
    for info in socket.getaddrinfo(u.hostname, 443):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Ese enlace apunta a una dirección no permitida.")


def task_ingest(ctx: Ctx, source_id: str) -> None:
    src = ctx.one("select * from sources where id=%s", source_id)
    if src is None:
        return
    folder = config.path_in_storage(f"sources/{source_id}")
    folder.mkdir(parents=True, exist_ok=True)
    if src["origin"] == "url":
        _safe_url(src["origin_url"])
        ctx.q("update sources set status='importing' where id=%s", source_id)
        dst = folder / "original.mp4"
        with requests.get(src["origin_url"], stream=True, timeout=60, allow_redirects=True) as r:
            r.raise_for_status()
            total = 0
            with open(dst, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    total += len(chunk)
                    if total > config.MAX_DOWNLOAD_BYTES:
                        raise ValueError("El archivo supera el tamaño máximo (4 GB).")
                    fh.write(chunk)
        ctx.q("update sources set storage_path=%s, size_bytes=%s where id=%s",
              f"sources/{source_id}/original.mp4", total, source_id)
        src = ctx.one("select * from sources where id=%s", source_id)

    ctx.q("update sources set status='probing' where id=%s", source_id)
    path = config.path_in_storage(src["storage_path"])
    info = media.probe(path)
    if not info.has_audio:
        raise media.MediaError("El vídeo no tiene audio: no hay nada que transcribir.")
    if info.duration > config.MAX_SOURCE_SECONDS:
        raise media.MediaError(f"El vídeo dura más de {config.MAX_SOURCE_SECONDS // 3600} h.")
    if info.duration < 20:
        raise media.MediaError("El vídeo es demasiado corto (mínimo 20 s).")
    ctx.q("""update sources set status='ready', duration_s=%s, width=%s, height=%s, fps=%s, error=null
             where id=%s""", info.duration, info.width, info.height, info.fps, source_id)


# ------------------------------------------------------------------ analyze

def _job_update(ctx: Ctx, job_id: str, status: str, progress: float) -> None:
    ctx.q("update jobs set status=%s, progress=%s where id=%s", status, round(progress, 3), job_id)


def task_analyze(ctx: Ctx, job_id: str) -> None:
    job = ctx.one("select * from jobs where id=%s", job_id)
    if job is None or job["status"] == "done":
        return
    src = ctx.one("select * from sources where id=%s", job["source_id"])
    st = job["settings"]
    rng = st.get("range") or [0, src["duration_s"]]
    rng = [max(0.0, float(rng[0])), min(float(src["duration_s"]), float(rng[1]))]
    minutes = minutes_for(rng[1] - rng[0])
    # volver a generar clips de un vídeo ya analizado es gratis (misma regla que la web)
    if ctx.one("""select 1 from jobs where source_id=%s and id<>%s and status='done' and minutes_charged>=%s""",
               src["id"], job_id, minutes):
        minutes = 0

    # cobro idempotente (unique job_id+reason)
    if minutes:
        ctx.q("""insert into usage_ledger (user_id, job_id, delta_min, reason)
                 values (%s, %s, %s, 'analysis') on conflict (job_id, reason) do nothing""",
              job["user_id"], job_id, -minutes)
    ctx.q("update jobs set minutes_charged=%s where id=%s", minutes, job_id)

    src_path = config.path_in_storage(src["storage_path"])

    # 1) transcripción (una vez por fuente)
    tr = ctx.one("select * from transcripts where source_id=%s", src["id"])
    if tr is None:
        _job_update(ctx, job_id, "transcribing", 0.02)
        audio = src_path.parent / "audio.wav"
        if not audio.exists():
            media.extract_audio(src_path, audio)
        last = [0.0]

        def prog(p):
            if p - last[0] >= 0.02:
                last[0] = p
                _job_update(ctx, job_id, "transcribing", 0.02 + 0.48 * p)

        lang, words, provider = asr.transcribe(audio, src["duration_s"], prog)
        if not words:
            raise media.MediaError("No se detectó voz en el vídeo.")
        ctx.q("""insert into transcripts (source_id, language, provider, words) values (%s,%s,%s,%s)
                 on conflict (source_id) do nothing""", src["id"], lang, provider, Jsonb(words))
        ctx.q("update sources set language=%s where id=%s", lang, src["id"])
        tr = ctx.one("select * from transcripts where source_id=%s", src["id"])
    words = tr["words"]

    # 2) elegir momentos
    _job_update(ctx, job_id, "selecting", 0.52)
    target = float(st.get("target_len", 60))
    picks, selector = select_clips(words, target, (rng[0], rng[1]), st.get("prompt", ""))
    ctx.q("update jobs set selector=%s where id=%s", selector, job_id)
    ctx.q("delete from clips where job_id=%s", job_id)  # reintentos: rehacer desde cero
    if not picks:
        _job_update(ctx, job_id, "done", 1.0)
        return

    # 3) por clip: reencuadre + vista previa (aparecen en la UI según terminan)
    aspect = st.get("aspect", "9:16")
    aw, ah = render.ASPECTS.get(aspect, render.ASPECTS["9:16"])
    for k, c in enumerate(picks):
        _job_update(ctx, job_id, "framing", 0.55 + 0.45 * k / len(picks))
        frame = framing.analyze(src_path, c["start_s"], c["end_s"], aw / ah, src["width"], src["height"])
        edit = {"aspect": aspect, "layout": frame["layout"], "crop": frame["crop"],
                "caption_style": st.get("caption_style", "impacto"), "hook": c["hook"],
                "show_hook": bool(st.get("auto_hook", True))}
        row = ctx.one("""insert into clips (user_id, job_id, source_id, rank, start_s, end_s, title, description,
                 hashtags, hook, score, sub_scores, reason, edit)
                 values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                      job["user_id"], job_id, src["id"], k + 1, c["start_s"], c["end_s"], c["title"],
                      c["description"], c["hashtags"], c["hook"], c["score"], Jsonb(c["sub_scores"]),
                      c["reason"], Jsonb(edit))
        clip_id = str(row["id"])
        _render_preview(ctx, clip_id, src, words, c["start_s"], c["end_s"], edit)
    _job_update(ctx, job_id, "done", 1.0)


def _render_preview(ctx: Ctx, clip_id: str, src: dict, words, start, end, edit) -> None:
    out_rel = f"clips/{clip_id}/preview.mp4"
    out = config.path_in_storage(out_rel)
    src_path = config.path_in_storage(src["storage_path"])
    render.render_clip(src_path, src["width"], src["height"], start, end, words, edit, out, preview=True)
    thumb_rel = f"clips/{clip_id}/thumb.jpg"
    media.thumbnail(out, config.path_in_storage(thumb_rel), at=min(1.5, (end - start) / 2))
    ctx.q("update clips set preview_path=%s, thumb_path=%s where id=%s", out_rel, thumb_rel, clip_id)


# ------------------------------------------------------------------ render

def task_render(ctx: Ctx, render_id: str) -> None:
    r = ctx.one("select * from renders where id=%s", render_id)
    if r is None or r["status"] == "done":
        return
    clip = ctx.one("select * from clips where id=%s", r["clip_id"])
    src = ctx.one("select * from sources where id=%s", clip["source_id"])
    tr = ctx.one("select words from transcripts where source_id=%s", src["id"])
    words = clip["edit"].get("words_override") or tr["words"]
    ctx.q("update renders set status='rendering' where id=%s", render_id)
    if r["purpose"] == "preview":
        _render_preview(ctx, str(clip["id"]), src, words, clip["start_s"], clip["end_s"], clip["edit"])
        ctx.q("update renders set status='done', progress=1, output_path=%s where id=%s",
              f"clips/{clip['id']}/preview.mp4", render_id)
        return
    if r["format"] == "srt":
        rel = f"renders/{render_id}.srt"
        p = config.path_in_storage(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(render.srt(words, clip["start_s"], clip["end_s"]), encoding="utf-8")
    else:
        rel = f"renders/{render_id}.mp4"
        render.render_clip(config.path_in_storage(src["storage_path"]), src["width"], src["height"],
                           clip["start_s"], clip["end_s"], words, clip["edit"], config.path_in_storage(rel))
    ctx.q("update renders set status='done', progress=1, output_path=%s where id=%s", rel, render_id)


# ------------------------------------------------------------------ fallos

def on_final_failure(ctx: Ctx, task: dict, message: str) -> None:
    kind, ref = task["kind"], task["ref_id"]
    if kind == "ingest":
        ctx.q("update sources set status='failed', error=%s where id=%s", message, ref)
    elif kind == "analyze":
        ctx.q("update jobs set status='failed', error=%s where id=%s", message, ref)
        job = ctx.one("select user_id, minutes_charged from jobs where id=%s", ref)
        if job and job["minutes_charged"]:
            ctx.q("""insert into usage_ledger (user_id, job_id, delta_min, reason) values (%s,%s,%s,'refund')
                     on conflict (job_id, reason) do nothing""", job["user_id"], ref, job["minutes_charged"])
    elif kind == "render":
        ctx.q("update renders set status='failed', error=%s where id=%s", message, ref)


HANDLERS = {"ingest": task_ingest, "analyze": task_analyze, "render": task_render}
USER_ERRORS = (media.MediaError, ValueError, requests.HTTPError)


def run_one(ctx: Ctx) -> bool:
    task = ctx.one(PICK_SQL)
    if task is None:
        return False
    log.info("tarea %s %s %s (intento %s)", task["id"], task["kind"], task["ref_id"], task["attempts"])
    t0 = time.time()
    try:
        HANDLERS[task["kind"]](ctx, str(task["ref_id"]))
        ctx.q("update tasks set status='done', locked_until=null where id=%s", task["id"])
        log.info("tarea %s hecha en %.1fs", task["id"], time.time() - t0)
    except Exception as exc:  # noqa: BLE001
        user_facing = isinstance(exc, USER_ERRORS)
        msg = str(exc)[:500] if user_facing else "Error interno al procesar el vídeo."
        log.error("tarea %s falló: %s\n%s", task["id"], exc, traceback.format_exc())
        if user_facing or task["attempts"] >= task["max_attempts"]:
            ctx.q("update tasks set status='failed', last_error=%s where id=%s", str(exc)[:2000], task["id"])
            on_final_failure(ctx, task, msg)
        else:
            ctx.q("""update tasks set status='queued', last_error=%s, locked_until=null,
                     run_after=now() + (interval '20 seconds' * attempts) where id=%s""",
                  str(exc)[:2000], task["id"])
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg no está instalado")
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    ctx = Ctx(conn)
    listen = connect()
    listen.execute("listen tasks")
    log.info("worker listo (almacenamiento: %s)", config.STORAGE_DIR)
    while True:
        while run_one(ctx):
            pass
        if args.once:
            return
        # espera a un NOTIFY o 5 s
        _select.select([listen.fileno()], [], [], 5)
        for _ in listen.notifies(timeout=0):
            pass


if __name__ == "__main__":
    main()
