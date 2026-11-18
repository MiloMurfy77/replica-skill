import { z } from "zod";
import { enqueue, getClip } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, json, withUser } from "@/lib/http";

const Body = z.object({ format: z.enum(["mp4", "srt"]).default("mp4") });

/** Encola la exportación final. Si ya existe una al día para esta versión, la reutiliza. */
export const POST = withUser(async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Formato no válido.");
  const clip = await getClip(user.id, id);
  const [existing] = await sql<{ id: string }[]>`
    select id from renders
    where clip_id = ${id} and user_id = ${user.id} and purpose = 'download' and format = ${parsed.data.format}
      and clip_version = ${clip.version} and status in ('queued','rendering','done')
    order by created_at desc limit 1`;
  if (existing) return json({ id: existing.id });
  const [r] = await sql<{ id: string }[]>`
    insert into renders (user_id, clip_id, clip_version, purpose, format)
    values (${user.id}, ${id}, ${clip.version}, 'download', ${parsed.data.format}) returning id`;
  await enqueue("render", r.id);
  return json({ id: r.id });
});
