import JobView from "@/components/JobView";
import { requireUser } from "@/lib/auth";
import { clipsForJob, getJob, getSource } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const job = await getJob(user.id, id).catch(() => null);
  if (!job) return <p className="text-muted">Proyecto no encontrado.</p>;
  const [clips, source] = await Promise.all([clipsForJob(user.id, id), getSource(user.id, job.source_id)]);
  return <JobView initialJob={JSON.parse(JSON.stringify(job))} initialClips={JSON.parse(JSON.stringify(clips))} sourceName={source.filename} />;
}
