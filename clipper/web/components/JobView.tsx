"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Clip, Job } from "@/lib/data";
import { fmtTime, JOB_STEPS, scoreColor } from "@/lib/format";
import DownloadButton from "./DownloadButton";

type Sort = "score" | "time";

export default function JobView({ initialJob, initialClips, sourceName }: { initialJob: Job; initialClips: Clip[]; sourceName: string }) {
  const [job, setJob] = useState(initialJob);
  const [clips, setClips] = useState(initialClips);
  const [sort, setSort] = useState<Sort>("score");
  const [showHidden, setShowHidden] = useState(false);
  const running = job.status !== "done" && job.status !== "failed";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/jobs/${job.id}`);
      if (!r.ok) return;
      const data = await r.json();
      setJob(data.job);
      setClips(data.clips);
    }, 2000);
    return () => clearInterval(t);
  }, [running, job.id]);

  const visible = useMemo(() => {
    const list = clips.filter((c) => c.preview_path && (showHidden || c.feedback !== "dislike"));
    return sort === "score" ? [...list].sort((a, b) => b.score - a.score) : [...list].sort((a, b) => a.start_s - b.start_s);
  }, [clips, sort, showHidden]);
  const hidden = clips.filter((c) => c.feedback === "dislike").length;

  async function patch(id: string, body: Partial<Clip>) {
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...body } : c)));
    await fetch(`/api/clips/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const stepIdx = JOB_STEPS.findIndex((s) => s.key === (job.status === "rendering" ? "framing" : job.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/sources/${job.source_id}`} className="text-sm text-muted hover:text-ink">
            ← {sourceName}
          </Link>
          <h1 className="text-2xl font-bold">
            {job.status === "done" ? `${clips.length} clips listos` : job.status === "failed" ? "Algo falló" : "Creando tus clips…"}
          </h1>
          {job.settings.prompt && <p className="text-sm text-muted">Búsqueda: “{job.settings.prompt}”</p>}
        </div>
        {job.status === "done" && (
          <Link href={`/sources/${job.source_id}`} className="btn-ghost">
            Generar otra vez con otros ajustes
          </Link>
        )}
      </div>

      {running && (
        <section className="card p-5" aria-live="polite">
          <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {JOB_STEPS.map((s, i) => (
              <li key={s.key} className={i < stepIdx ? "text-ok" : i === stepIdx ? "font-semibold text-ink" : "text-muted"}>
                {i < stepIdx ? "✓ " : i === stepIdx ? "● " : "○ "}
                {s.label}
              </li>
            ))}
          </ol>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent transition-all duration-700" style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Puedes cerrar esta página: el trabajo sigue en segundo plano. Los clips aparecen aquí según se terminan.
          </p>
        </section>
      )}

      {job.status === "failed" && (
        <section className="card border-danger/40 p-5">
          <p className="text-danger">{job.error ?? "Error desconocido."}</p>
        </section>
      )}

      {job.status === "done" && clips.length === 0 && (
        <section className="card p-6 text-sm text-muted">
          No encontramos momentos que encajen{job.settings.prompt ? " con tu búsqueda" : ""}. Prueba con otra búsqueda o con clips más cortos.
        </section>
      )}

      {clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Ordenar:</span>
          <button className={sort === "score" ? "chip-on" : "chip"} onClick={() => setSort("score")}>
            Mejor puntuación
          </button>
          <button className={sort === "time" ? "chip-on" : "chip"} onClick={() => setSort("time")}>
            Orden del vídeo
          </button>
          {hidden > 0 && (
            <button className="chip ml-auto" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "Ocultar descartados" : `Ver ${hidden} descartados`}
            </button>
          )}
        </div>
      )}

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <li key={c.id} className={`card overflow-hidden ${c.feedback === "dislike" ? "opacity-50" : ""}`}>
            <div className="relative bg-black">
              <video
                src={`/api/files/preview/${c.id}?v=${c.version}`}
                poster={`/api/files/thumb/${c.id}?v=${c.version}`}
                controls
                preload="none"
                playsInline
                className={`mx-auto block ${c.edit.aspect === "16:9" ? "aspect-video w-full" : c.edit.aspect === "1:1" ? "aspect-square w-full" : "aspect-[9/16] h-[480px] max-w-full"}`}
              />
              <span
                className={`absolute left-3 top-3 rounded-full border bg-bg/85 px-2.5 py-1 text-sm font-bold ${scoreColor(c.score)}`}
                title={`Gancho ${c.sub_scores.hook ?? "–"} · Fluidez ${c.sub_scores.flow ?? "–"} · Valor ${c.sub_scores.value ?? "–"} · Tendencia ${c.sub_scores.trend ?? "–"}`}
              >
                {c.score}
                <span className="text-xs font-normal">/99</span>
              </span>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <p className="font-semibold leading-snug">{c.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {fmtTime(c.start_s)} – {fmtTime(c.end_s)} · {Math.round(c.end_s - c.start_s)} s
                </p>
              </div>
              <dl className="grid grid-cols-4 gap-1 text-center text-xs">
                {(
                  [
                    ["Gancho", c.sub_scores.hook],
                    ["Fluidez", c.sub_scores.flow],
                    ["Valor", c.sub_scores.value],
                    ["Tendencia", c.sub_scores.trend],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-panel-2 py-1.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-semibold">{v ?? "–"}</dd>
                  </div>
                ))}
              </dl>
              {c.reason && <p className="text-xs text-muted">{c.reason}</p>}
              <div className="flex items-center gap-1">
                <button
                  className={`rounded-lg px-2 py-1.5 text-lg ${c.feedback === "like" ? "bg-ok/20" : "hover:bg-panel-2"}`}
                  aria-label="Me gusta"
                  aria-pressed={c.feedback === "like"}
                  onClick={() => patch(c.id, { feedback: c.feedback === "like" ? null : "like" })}
                >
                  👍
                </button>
                <button
                  className={`rounded-lg px-2 py-1.5 text-lg ${c.feedback === "dislike" ? "bg-danger/20" : "hover:bg-panel-2"}`}
                  aria-label="Descartar"
                  aria-pressed={c.feedback === "dislike"}
                  onClick={() => patch(c.id, { feedback: c.feedback === "dislike" ? null : "dislike" })}
                >
                  👎
                </button>
                <button
                  className={`rounded-lg px-2 py-1.5 text-lg ${c.starred ? "text-yellow-300" : "text-muted hover:bg-panel-2"}`}
                  aria-label="Destacar"
                  aria-pressed={c.starred}
                  onClick={() => patch(c.id, { starred: !c.starred })}
                >
                  ★
                </button>
                <Link href={`/clips/${c.id}`} className="btn-ghost ml-auto px-3 py-2">
                  Editar
                </Link>
                <DownloadButton clipId={c.id} className="btn-primary px-3 py-2" label="Descargar" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
