import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getClip, getRender } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, withUser } from "@/lib/http";
import { storagePath } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = (s: string) =>
  s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip";

/**
 * Sirve archivos solo a su dueño. El cliente nunca manda rutas: solo un tipo y un id.
 *   preview/:clipId  thumb/:clipId  render/:renderId (descarga)
 */
export const GET = withUser(async (user, req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await ctx.params;
  let rel: string | null = null;
  let type = "video/mp4";
  let download: string | null = null;
  if (kind === "preview" || kind === "thumb") {
    const c = await getClip(user.id, id);
    rel = kind === "preview" ? c.preview_path : c.thumb_path;
    if (kind === "thumb") type = "image/jpeg";
  } else if (kind === "render") {
    const r = await getRender(user.id, id);
    if (r.status !== "done") throw new HttpError(409, "La exportación aún no está lista.");
    rel = r.output_path;
    const [c] = await sql<{ title: string }[]>`select title from clips where id = ${r.clip_id}`;
    download = `${slug(c?.title ?? "clip")}.${r.format}`;
    if (r.format === "srt") type = "application/x-subrip";
  } else {
    throw new HttpError(404, "No encontrado.");
  }
  if (!rel) throw new HttpError(404, "Archivo aún no disponible.");
  const file = storagePath(rel);
  const { size } = await stat(file).catch(() => {
    throw new HttpError(404, "Archivo no encontrado.");
  });

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download}"`;

  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
});
