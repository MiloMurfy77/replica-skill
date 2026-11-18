"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Clip } from "@/lib/data";
import { fmtTime, scoreColor } from "@/lib/format";
import DownloadButton from "./DownloadButton";

const STYLES = [
  { v: "impacto", l: "Impacto" },
  { v: "karaoke", l: "Karaoke" },
  { v: "minimal", l: "Minimal" },
  { v: "none", l: "Sin subtítulos" },
];

export default function ClipEditor({ initial, sourceDuration }: { initial: Clip; sourceDuration: number }) {
  const [clip, setClip] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [hook, setHook] = useState(initial.hook);
  const [showHook, setShowHook] = useState(initial.edit.show_hook !== false);
  const [style, setStyle] = useState(initial.edit.caption_style ?? "impacto");
  const [layout, setLayout] = useState(initial.edit.layout ?? "fill");
  const [start, setStart] = useState(initial.start_s);
  const [end, setEnd] = useState(initial.end_s);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(initial.version);

  const dirty =
    title !== clip.title ||
    description !== clip.description ||
    hook !== clip.hook ||
    showHook !== (clip.edit.show_hook !== false) ||
    style !== (clip.edit.caption_style ?? "impacto") ||
    layout !== (clip.edit.layout ?? "fill") ||
    start !== clip.start_s ||
    end !== clip.end_s;

  // Espera a que la nueva vista previa esté lista
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(async () => {
      const data = await fetch(`/api/jobs/${clip.job_id}`).then((x) => x.json());
      const fresh = (data.clips as Clip[]).find((c) => c.id === clip.id);
      if (fresh && new Date(fresh.updated_at).getTime() > new Date(clip.updated_at).getTime() && fresh.preview_path) {
        setClip(fresh);
        setVersion(fresh.version);
        setRendering(false);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [rendering, clip.id, clip.job_id, clip.updated_at]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description, hook, show_hook: showHook, caption_style: style, layout, start_s: start, end_s: end }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "No se pudo guardar.");
      return;
    }
    const visual = data.version !== clip.version;
    setClip(data);
    if (visual) setRendering(true);
  }

  const nudge = (which: "start" | "end", d: number) => {
    if (which === "start") setStart((s) => Math.max(0, Math.min(+(s + d).toFixed(2), end - 3)));
    else setEnd((e) => Math.min(sourceDuration, Math.max(+(e + d).toFixed(2), start + 3)));
  };

  const aspectClass =
    clip.edit.aspect === "16:9" ? "aspect-video" : clip.edit.aspect === "1:1" ? "aspect-square" : "aspect-[9/16]";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="space-y-3">
        <Link href={`/jobs/${clip.job_id}`} className="text-sm text-muted hover:text-ink">
          ← Todos los clips
        </Link>
        <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
          <video
            key={version}
            src={`/api/files/preview/${clip.id}?v=${version}`}
            poster={`/api/files/thumb/${clip.id}?v=${version}`}
            controls
            playsInline
            className={`w-full ${aspectClass}`}
          />
          {rendering && (
            <div className="absolute inset-0 grid place-items-center bg-bg/70 text-sm" aria-live="polite">
              Regenerando la vista previa…
            </div>
          )}
          <span className={`absolute left-3 top-3 rounded-full border bg-bg/85 px-2.5 py-1 text-sm font-bold ${scoreColor(clip.score)}`}>
            {clip.score}/99
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <DownloadButton clipId={clip.id} />
          <DownloadButton clipId={clip.id} format="srt" className="btn-ghost" label="Subtítulos .srt" />
        </div>
        {dirty && <p className="text-xs text-muted">Guarda los cambios antes de descargar para incluirlos.</p>}
      </div>

      <div className="card space-y-6 p-5 sm:p-6">
        <div>
          <label className="text-sm font-semibold" htmlFor="title">
            Título
          </label>
          <input id="title" className="input mt-1" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="desc">
            Descripción para la publicación
          </label>
          <textarea id="desc" className="input mt-1 min-h-20" value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
          {clip.hashtags.length > 0 && <p className="mt-1 text-sm text-accent">{clip.hashtags.map((h) => `#${h}`).join(" ")}</p>}
        </div>

        <div>
          <p className="text-sm font-semibold">Recorte</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(["start", "end"] as const).map((w) => (
              <div key={w} className="rounded-xl bg-panel-2 p-3">
                <p className="text-xs text-muted">{w === "start" ? "Empieza en" : "Termina en"}</p>
                <p className="text-lg font-semibold tabular-nums">{fmtTime(w === "start" ? start : end)}</p>
                <div className="mt-2 flex gap-1">
                  {[-5, -1, -0.5, 0.5, 1, 5].map((d) => (
                    <button key={d} className="chip px-2 py-1 text-xs" onClick={() => nudge(w, d)}>
                      {d > 0 ? `+${d}` : d}s
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Duración: {Math.round(end - start)} s</p>
        </div>

        <div>
          <p className="text-sm font-semibold">Encuadre</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={layout === "fill" ? "chip-on" : "chip"} onClick={() => setLayout("fill")}>
              Seguir a quien habla
            </button>
            <button className={layout === "fit" ? "chip-on" : "chip"} onClick={() => setLayout("fit")}>
              Vídeo completo con fondo
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold">Subtítulos</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button key={s.v} className={style === s.v ? "chip-on" : "chip"} onClick={() => setStyle(s.v)}>
                {s.l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={showHook} onChange={(e) => setShowHook(e.target.checked)} />
            Gancho de texto al inicio
          </label>
          <input className="input mt-2" value={hook} maxLength={80} disabled={!showHook} onChange={(e) => setHook(e.target.value)} />
        </div>

        {clip.reason && (
          <p className="rounded-xl bg-panel-2 p-3 text-sm text-muted">
            <span className="font-semibold text-ink">Por qué este momento: </span>
            {clip.reason}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={!dirty || saving || rendering}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {dirty && (
            <button
              className="btn-ghost"
              onClick={() => {
                setTitle(clip.title);
                setDescription(clip.description);
                setHook(clip.hook);
                setShowHook(clip.edit.show_hook !== false);
                setStyle(clip.edit.caption_style ?? "impacto");
                setLayout(clip.edit.layout ?? "fill");
                setStart(clip.start_s);
                setEnd(clip.end_s);
              }}
            >
              Descartar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
