"use client";

import { useRef, useState } from "react";

type Tab = "file" | "url";

export default function Uploader() {
  const [tab, setTab] = useState<Tab>("file");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    if (file.size > 4 * 1024 ** 3) {
      setError("El archivo supera 4 GB.");
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/sources");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) window.location.href = `/sources/${data.id}`;
      else {
        setError(data.error ?? "La subida falló.");
        setProgress(null);
      }
    };
    xhr.onerror = () => {
      setError("Se cortó la conexión durante la subida.");
      setProgress(null);
    };
    setProgress(0);
    xhr.send(file);
  }

  async function importUrl(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress(0);
    const res = await fetch("/api/sources/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) window.location.href = `/sources/${data.id}`;
    else {
      setError(data.error ?? "No se pudo importar.");
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Nuevo vídeo</h2>
        <div className="flex gap-1 rounded-xl bg-panel-2 p-1 text-sm">
          {(["file", "url"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 ${tab === t ? "bg-bg text-ink" : "text-muted"}`}
            >
              {t === "file" ? "Subir archivo" : "Pegar enlace"}
            </button>
          ))}
        </div>
      </div>

      {tab === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f && !busy) upload(f);
          }}
          onClick={() => !busy && input.current?.click()}
          className={`mt-4 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            drag ? "border-accent bg-accent/5" : "border-line hover:border-muted"
          }`}
        >
          <input
            ref={input}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv,.m4v"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {busy ? (
            <div className="w-full max-w-sm">
              <p className="text-sm">Subiendo… {Math.round((progress ?? 0) * 100)}%</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent transition-all" style={{ width: `${(progress ?? 0) * 100}%` }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-base font-medium">Arrastra tu vídeo largo aquí o haz clic</p>
              <p className="mt-1 text-sm text-muted">Podcast, entrevista, webinar… MP4, MOV o WEBM · hasta 4 GB y 3 h</p>
            </>
          )}
        </div>
      ) : (
        <form onSubmit={importUrl} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            type="url"
            required
            placeholder="https://… enlace directo a un .mp4 (Dropbox, Drive público, tu servidor)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn-primary shrink-0" disabled={busy}>
            {busy ? "Importando…" : "Importar"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
