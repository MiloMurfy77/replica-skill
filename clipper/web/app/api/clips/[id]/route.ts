import { z } from "zod";
import { enqueue, getClip, sourceDurationForClip } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, json, withUser } from "@/lib/http";

const Body = z.object({
  feedback: z.enum(["like", "dislike"]).nullable().optional(),
  starred: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(600).optional(),
  start_s: z.number().min(0).optional(),
  end_s: z.number().min(0).optional(),
  hook: z.string().max(80).optional(),
  show_hook: z.boolean().optional(),
  caption_style: z.enum(["impacto", "karaoke", "minimal", "none"]).optional(),
  layout: z.enum(["fill", "fit"]).optional(),
});

/** Cambios que alteran el vídeo y obligan a regenerar la vista previa. */
const VISUAL = ["start_s", "end_s", "hook", "show_hook", "caption_style", "layout"] as const;

export const PATCH = withUser(async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const b = parsed.data;
  const clip = await getClip(user.id, id);

  const start = b.start_s ?? clip.start_s;
  const end = b.end_s ?? clip.end_s;
  if (b.start_s !== undefined || b.end_s !== undefined) {
    const dur = await sourceDurationForClip(user.id, id);
    if (end <= start + 3) throw new HttpError(400, "El clip debe durar al menos 3 segundos.");
    if (end - start > 15 * 60) throw new HttpError(400, "El clip no puede durar más de 15 minutos.");
    if (end > dur) throw new HttpError(400, "El final supera la duración del vídeo.");
  }
  const edit = { ...clip.edit };
  if (b.hook !== undefined) edit.hook = b.hook;
  if (b.show_hook !== undefined) edit.show_hook = b.show_hook;
  if (b.caption_style !== undefined) edit.caption_style = b.caption_style;
  if (b.layout !== undefined) edit.layout = b.layout;
  const visual = VISUAL.some((k) => b[k] !== undefined);

  const [updated] = await sql`
    update clips set
      feedback = ${b.feedback === undefined ? clip.feedback : b.feedback},
      starred = ${b.starred ?? clip.starred},
      title = ${b.title ?? clip.title},
      description = ${b.description ?? clip.description},
      hook = ${b.hook ?? clip.hook},
      start_s = ${start}, end_s = ${end},
      edit = ${sql.json(edit)},
      version = version + ${visual ? 1 : 0}
    where id = ${id} and user_id = ${user.id}
    returning *`;

  if (visual) {
    const [r] = await sql<{ id: string }[]>`
      insert into renders (user_id, clip_id, clip_version, purpose, height)
      values (${user.id}, ${id}, ${updated.version}, 'preview', 960) returning id`;
    await enqueue("render", r.id);
  }
  return json(updated);
});
