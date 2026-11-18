import ClipEditor from "@/components/ClipEditor";
import { requireUser } from "@/lib/auth";
import { getClip, sourceDurationForClip } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const clip = await getClip(user.id, id).catch(() => null);
  if (!clip) return <p className="text-muted">Clip no encontrado.</p>;
  const duration = await sourceDurationForClip(user.id, id);
  return <ClipEditor initial={JSON.parse(JSON.stringify(clip))} sourceDuration={duration} />;
}
