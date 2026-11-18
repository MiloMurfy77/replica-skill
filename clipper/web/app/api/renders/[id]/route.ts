import { getRender } from "@/lib/data";
import { json, withUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withUser(async (user, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const r = await getRender(user.id, id);
  return json({ id: r.id, status: r.status, error: r.error, format: r.format });
});
