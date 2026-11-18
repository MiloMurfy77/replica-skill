"use client";

import { useState } from "react";

/** Pide la exportación, espera a que termine y descarga. */
export default function DownloadButton({
  clipId,
  format = "mp4",
  className = "btn-primary",
  label,
}: {
  clipId: string;
  format?: "mp4" | "srt";
  className?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setState("working");
    setError(null);
    const res = await fetch(`/api/clips/${clipId}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("error");
      setError(data.error ?? "No se pudo exportar.");
      return;
    }
    for (let i = 0; i < 900; i++) {
      const r = await fetch(`/api/renders/${data.id}`).then((x) => x.json());
      if (r.status === "done") {
        window.location.href = `/api/files/render/${data.id}`;
        setState("idle");
        return;
      }
      if (r.status === "failed") {
        setState("error");
        setError(r.error ?? "La exportación falló.");
        return;
      }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    setState("error");
    setError("Está tardando demasiado. Inténtalo de nuevo.");
  }

  return (
    <span className="inline-flex flex-col">
      <button className={className} onClick={go} disabled={state === "working"}>
        {state === "working" ? "Exportando…" : (label ?? (format === "srt" ? "SRT" : "Descargar MP4"))}
      </button>
      {error && <span className="mt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}
