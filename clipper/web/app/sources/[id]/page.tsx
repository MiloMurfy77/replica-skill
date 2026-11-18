import Link from "next/link";
import SourceSetup from "@/components/SourceSetup";
import { requireUser } from "@/lib/auth";
import { getSource, jobsForSource, minutesBalance } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const source = await getSource(user.id, id).catch(() => null);
  if (!source) return <p className="text-muted">Vídeo no encontrado.</p>;
  const [balance, jobs] = await Promise.all([minutesBalance(user.id), jobsForSource(user.id, id)]);
  const full = Math.max(1, Math.floor((source.duration_s ?? 0) / 60));
  const freeReprompt = jobs.some((j) => j.status === "done" && j.minutes_charged >= full);
  return (
    <div className="space-y-6">
      {jobs.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2 p-4 text-sm">
          <span className="text-muted">Generaciones anteriores:</span>
          {jobs.map((j, i) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="chip">
              #{jobs.length - i} · {j.settings.prompt ? `"${j.settings.prompt.slice(0, 30)}"` : "automática"}
            </Link>
          ))}
        </div>
      )}
      <SourceSetup
        initial={{ ...source, created_at: undefined } as never}
        balance={balance}
        freeReprompt={freeReprompt}
      />
    </div>
  );
}
