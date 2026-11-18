import { getSource } from "@/lib/data";
import { json, withUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withUser(async (user, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return json(await getSource(user.id, id));
});
