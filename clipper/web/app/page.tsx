import Link from "next/link";
import Uploader from "@/components/Uploader";
import { requireUser } from "@/lib/auth";
import { listSources } from "@/lib/data";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  uploading: "Subiendo",
  importing: "Importando",
  probing: "Preparando",
  ready: "Listo para analizar",
  failed: "Error",
  queued: "En cola",
  transcribing: "Transcribiendo",
  selecting: "Eligiendo momentos",
  framing: "Creando clips",
  done: "Clips listos",
};

export default async function Home() {
  const user = await requireUser();
  const sources = await listSources(user.id);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">De un vídeo largo a decenas de clips</h1>
        <p className="mt-1 text-muted">Sube tu vídeo y recibe clips verticales con subtítulos, encuadre y título.</p>
      </div>
      <Uploader />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Tus vídeos</h2>
        {sources.length === 0 ? (
          <p className="card p-6 text-sm text-muted">Todavía no has subido ningún vídeo. Empieza arriba.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map((s) => {
              const href = s.last_job && s.last_status !== "failed" ? `/jobs/${s.last_job}` : `/sources/${s.id}`;
              const status = s.status !== "ready" ? s.status : (s.last_status ?? "ready");
              return (
                <li key={s.id}>
                  <Link href={href} className="card block p-4 transition hover:border-muted">
                    <p className="truncate font-medium" title={s.filename}>
                      {s.filename}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {fmtTime(s.duration_s)} · {s.clips} clips
                    </p>
                    <span
                      className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-xs ${
                        status === "failed"
                          ? "bg-danger/15 text-danger"
                          : status === "done"
                            ? "bg-accent/15 text-accent"
                            : "bg-panel-2 text-muted"
                      }`}
                    >
                      {STATUS[status] ?? status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
