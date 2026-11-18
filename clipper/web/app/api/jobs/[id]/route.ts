import { clipsForJob, getJob } from "@/lib/data";
import { json, withUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withUser(async (user, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = await getJob(user.id, id);
  const clips = await clipsForJob(user.id, id);
  return json({ job, clips });
});
