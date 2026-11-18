import { z } from "zod";
import { enqueue } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, json, withUser } from "@/lib/http";

const Body = z.object({ url: z.string().url().max(2000) });

/** Importa un vídeo desde un enlace directo https (Drive/Dropbox público o .mp4). */
export const POST = withUser(async (user, req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Pega un enlace válido.");
  const url = new URL(parsed.data.url);
  if (url.protocol !== "https:") throw new HttpError(400, "Solo se aceptan enlaces https.");
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname))
    throw new HttpError(400, "Los enlaces de YouTube no se pueden importar: sube el archivo de vídeo.");
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "video.mp4").slice(0, 200);
  const [src] = await sql<{ id: string }[]>`
    insert into sources (user_id, origin, origin_url, filename, status)
    values (${user.id}, 'url', ${url.toString()}, ${filename}, 'importing') returning id`;
  await enqueue("ingest", src.id);
  return json({ id: src.id });
});
