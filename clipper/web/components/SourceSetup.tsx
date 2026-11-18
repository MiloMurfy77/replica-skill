"use client";

import { useEffect, useState } from "react";
import { fmtTime, parseTime } from "@/lib/format";

type Source = {
  id: string;
  filename: string;
  status: string;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

const LENGTHS = [
  { v: 30, l: "30 s" },
  { v: 45, l: "45 s" },
  { v: 60, l: "60 s" },
  { v: 90, l: "90 s" },
  { v: 120, l: "2 min" },
];
const ASPECTS = [
  { v: "9:16", l: "Vertical 9:16", d: "TikTok, Reels, Shorts" },
  { v: "1:1", l: "Cuadrado 1:1", d: "Feed de Instagram, LinkedIn" },
  { v: "16:9", l: "Horizontal 16:9", d: "YouTube, X" },
] as const;
const STYLES = [
  { v: "impacto", l: "Impacto", d: "MAYÚSCULAS, palabra activa en amarillo" },
  { v: "karaoke", l: "Karaoke", d: "Palabra activa en verde" },
  { v: "minimal", l: "Minimal", d: "Frase completa, discreto" },
  { v: "none", l: "Sin subtítulos", d: "Si tu vídeo ya los trae" },
] as const;

export default function SourceSetup({ initial }: { initial: Source }) {
  const [src, setSrc] = useState(initial);
  const [targetLen, setTargetLen] = useState(60);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["v"]>("9:16");
  const [style, setStyle] = useState<(typeof STYLES)[number]["v"]>("impacto");
  const [prompt, setPrompt] = useState("");
  const [autoHook, setAutoHook] = useState(true);
  const [useRange, setUseRange] = useState(false);
  const [rangeA, setRangeA] = useState("0:00");
  const [rangeB, setRangeB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = src.status === "ready";
  useEffect(() => {
    if (ready || src.status === "failed") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/sources/${src.id}`);
      if (r.ok) setSrc(await r.json());
    }, 1500);
    return () => clearInterval(t);
  }, [ready, src.id, src.status]);

  useEffect(() => {
    if (src.duration_s && !rangeB) setRangeB(fmtTime(src.duration_s));
  }, [src.duration_s, rangeB]);

  const a = parseTime(rangeA) ?? 0;
  const b = parseTime(rangeB) ?? src.duration_s ?? 0;
  const span = useRange ? Math.max(0, Math.min(b, src.duration_s ?? b) - a) : (src.duration_s ?? 0);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_id: src.id,
        target_len: targetLen,
        aspect,
        caption_style: style,
        prompt,
        auto_hook: autoHook,
        range: useRange ? [a, b] : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) window.location.href = `/jobs/${data.id}`;
    else {
      setError(data.error ?? "No se pudo empezar.");
      setBusy(false);
    }
  }

  if (src.status === "failed")
    return (
      <div className="card p-6">
        <p className="font-medium text-danger">No pudimos procesar este vídeo.</p>
        <p className="mt-1 text-sm text-muted">{src.error ?? "Error desconocido."}</p>
        <a href="/" className="btn-ghost mt-4">
          Volver
        </a>
      </div>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card space-y-7 p-5 sm:p-6">
        <div>
          <p className="truncate text-sm text-muted">{src.filename}</p>
          <h1 className="text-2xl font-bold">Ajustes de los clips</h1>
          <p className="mt-1 text-sm text-muted">
            {ready
              ? `Duración ${fmtTime(src.duration_s)} · ${src.width}×${src.height}`
              : "Preparando el vídeo… puedes ir eligiendo los ajustes."}
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Duración de cada clip</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LENGTHS.map((o) => (
              <button key={o.v} type="button" onClick={() => setTargetLen(o.v)} className={targetLen === o.v ? "chip-on" : "chip"}>
                {o.l}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={15}
            max={180}
            step={5}
            value={targetLen}
            onChange={(e) => setTargetLen(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--color-accent)]"
            aria-label="Duración objetivo en segundos"
          />
          <p className="text-xs text-muted">Unos {targetLen} s (la IA ajusta para que cada clip acabe en una frase completa).</p>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold">Formato</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {ASPECTS.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setAspect(o.v)}
                className={`rounded-xl border p-3 text-left transition ${aspect === o.v ? "border-accent bg-accent/5" : "border-line hover:border-muted"}`}
              >
                <span className="block text-sm font-medium">{o.l}</span>
                <span className="block text-xs text-muted">{o.d}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold">Estilo de subtítulos</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {STYLES.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setStyle(o.v)}
                className={`rounded-xl border p-3 text-left transition ${style === o.v ? "border-accent bg-accent/5" : "border-line hover:border-muted"}`}
              >
                <span
                  className={`block text-sm ${o.v === "impacto" ? "font-black uppercase" : o.v === "karaoke" ? "font-extrabold" : "font-medium"}`}
                >
                  {o.v === "impacto" ? (
                    <>
                      Así <span className="text-yellow-300">suena</span>
                    </>
                  ) : o.v === "karaoke" ? (
                    <>
                      Así <span className="text-ok">suena</span>
                    </>
                  ) : (
                    o.l
                  )}
                </span>
                <span className="block text-xs text-muted">
                  {o.v === "impacto" || o.v === "karaoke" ? `${o.l} · ` : ""}
                  {o.d}
                </span>
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoHook} onChange={(e) => setAutoHook(e.target.checked)} />
            Añadir gancho de texto en los primeros segundos
          </label>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold">¿Buscas algo concreto? (opcional)</legend>
          <textarea
            className="input mt-2 min-h-20"
            maxLength={500}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ej.: todos los momentos en los que habla de cómo consiguió sus primeros clientes"
          />
        </fieldset>

        <fieldset>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
            Analizar solo un tramo del vídeo
          </label>
          {useRange && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input className="input w-28" value={rangeA} onChange={(e) => setRangeA(e.target.value)} aria-label="Desde" />
              <span className="text-muted">hasta</span>
              <input className="input w-28" value={rangeB} onChange={(e) => setRangeB(e.target.value)} aria-label="Hasta" />
              <span className="text-muted">(m:ss o h:mm:ss)</span>
            </div>
          )}
        </fieldset>
      </div>

      <aside className="card h-fit space-y-4 p-5 lg:sticky lg:top-20">
        <div>
          <p className="text-sm text-muted">Se analizarán</p>
          <p className="text-2xl font-bold">{ready ? fmtTime(span) : "–"}</p>
          <p className="text-xs text-muted">de vídeo. Suele tardar menos que la duración del vídeo.</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full py-3 text-base" disabled={!ready || busy} onClick={start}>
          {!ready ? "Preparando vídeo…" : busy ? "Empezando…" : "Generar clips"}
        </button>
      </aside>
    </div>
  );
}
