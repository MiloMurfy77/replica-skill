import fs from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { enqueue } from "@/lib/data";
import { sql } from "@/lib/db";
import { HttpError, json, withUser } from "@/lib/http";
import { storagePath } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 ** 3; // 4 GB
const ALLOWED = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

/** Subida en streaming: el cuerpo es el archivo tal cual, el nombre va en x-filename. */
export const POST = withUser(async (user, req: Request) => {
  const rawName = decodeURIComponent(req.headers.get("x-filename") ?? "video.mp4");
  const filename = path.basename(rawName).slice(0, 200) || "video.mp4";
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED.has(ext)) throw new HttpError(400, "Formato no soportado. Usa MP4, MOV, M4V, WEBM o MKV.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new HttpError(413, "El archivo supera 4 GB.");
  if (!req.body) throw new HttpError(400, "No llegó ningún archivo.");

  const [src] = await sql<{ id: string }[]>`
    insert into sources (user_id, origin, filename, status) values (${user.id}, 'upload', ${filename}, 'uploading')
    returning id`;
  const rel = `sources/${src.id}/original${ext}`;
  const dst = storagePath(rel);
  await mkdir(path.dirname(dst), { recursive: true });

  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      received += chunk.byteLength;
      if (received > MAX_BYTES) ctrl.error(new HttpError(413, "El archivo supera 4 GB."));
      else ctrl.enqueue(chunk);
    },
  });
  try {
    const body = req.body.pipeThrough(limiter) as unknown as WebReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(dst));
  } catch (e) {
    await rm(path.dirname(dst), { recursive: true, force: true });
    await sql`update sources set status = 'failed', error = 'La subida se interrumpió.' where id = ${src.id}`;
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "La subida se interrumpió. Inténtalo de nuevo.");
  }
  const { size } = await stat(dst);
  await sql`update sources set storage_path = ${rel}, size_bytes = ${size}, status = 'probing' where id = ${src.id}`;
  await enqueue("ingest", src.id);
  return json({ id: src.id });
});
