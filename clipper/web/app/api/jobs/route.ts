import { z } from "zod";
import { enqueue, getSource, minutesBalance } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, json, withUser } from "@/lib/http";

const Body = z.object({
  source_id: z.string().uuid(),
  target_len: z.number().int().min(15).max(180).default(60),
  aspect: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  caption_style: z.enum(["impacto", "karaoke", "minimal", "none"]).default("impacto"),
  prompt: z.string().max(500).default(""),
  range: z.tuple([z.number().min(0), z.number().min(0)]).nullable().default(null),
  auto_hook: z.boolean().default(true),
});

export const POST = withUser(async (user, req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const s = parsed.data;
  const source = await getSource(user.id, s.source_id);
  if (source.status !== "ready" || !source.duration_s) throw new HttpError(409, "El vídeo aún no está listo.");

  let range = s.range;
  if (range) {
    const a = Math.max(0, Math.min(range[0], range[1]));
    const b = Math.min(source.duration_s, Math.max(range[0], range[1]));
    if (b - a < 30) throw new HttpError(400, "El tramo a analizar debe durar al menos 30 segundos.");
    range = [a, b];
  }
  const span = range ? range[1] - range[0] : source.duration_s;
  // Volver a generar clips de un vídeo ya analizado es gratis (la transcripción se reutiliza).
  // (solo si ya se pagó un análisis al menos igual de largo).
  const needed = Math.max(1, Math.floor(span / 60));
  const [prev] = await sql`
    select 1 from jobs where source_id = ${source.id} and user_id = ${user.id}
      and status = 'done' and minutes_charged >= ${needed} limit 1`;
  const minutes = prev ? 0 : needed;
  const balance = await minutesBalance(user.id);
  if (balance < minutes)
    throw new HttpError(402, `Este vídeo necesita ${minutes} min y te quedan ${balance}. Recorta el tramo o amplía tu plan.`);

  const settings = { ...s, range, source_id: undefined };
  const [job] = await sql<{ id: string }[]>`
    insert into jobs (user_id, source_id, settings) values (${user.id}, ${source.id}, ${sql.json(settings)})
    returning id`;
  await enqueue("analyze", job.id);
  return json({ id: job.id });
});
