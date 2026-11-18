/**
 * Capa de datos. TODAS las lecturas y escrituras filtran por el dueño (user_id):
 * esta es la regla de acceso de la app.
 */
import { sql } from "./db";
import { HttpError } from "./http";

export type Source = {
  id: string;
  filename: string;
  origin: "upload" | "url";
  status: "uploading" | "importing" | "probing" | "ready" | "failed";
  duration_s: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  created_at: Date;
};

export type JobSettings = {
  target_len: number;
  aspect: "9:16" | "1:1" | "16:9";
  caption_style: "impacto" | "karaoke" | "minimal" | "none";
  prompt: string;
  range: [number, number] | null;
  auto_hook: boolean;
};

export type Job = {
  id: string;
  source_id: string;
  settings: JobSettings;
  status: "queued" | "transcribing" | "selecting" | "framing" | "rendering" | "done" | "failed";
  progress: number;
  minutes_charged: number;
  selector: string | null;
  error: string | null;
  created_at: Date;
};

export type Clip = {
  id: string;
  job_id: string;
  source_id: string;
  rank: number;
  start_s: number;
  end_s: number;
  title: string;
  description: string;
  hashtags: string[];
  hook: string;
  score: number;
  sub_scores: { hook?: number; flow?: number; value?: number; trend?: number };
  reason: string;
  feedback: "like" | "dislike" | null;
  starred: boolean;
  edit: {
    aspect?: string;
    layout?: "fill" | "fit";
    caption_style?: string;
    hook?: string;
    show_hook?: boolean;
    crop?: { t: number; cx: number }[];
  };
  version: number;
  preview_path: string | null;
  thumb_path: string | null;
  updated_at: Date;
};

export type Render = {
  id: string;
  clip_id: string;
  clip_version: number;
  purpose: "preview" | "download";
  format: "mp4" | "srt";
  status: "queued" | "rendering" | "done" | "failed";
  output_path: string | null;
  error: string | null;
  created_at: Date;
};

export async function minutesBalance(userId: string): Promise<number> {
  const [r] = await sql<{ b: number }[]>`
    select coalesce(sum(delta_min), 0)::int as b from usage_ledger where user_id = ${userId}`;
  return r.b;
}

export async function enqueue(kind: "ingest" | "analyze" | "render", refId: string) {
  await sql`insert into tasks (kind, ref_id) values (${kind}, ${refId})`;
}

// ---------------------------------------------------------------- sources

export async function listSources(userId: string) {
  return sql<(Source & { clips: number; last_job: string | null; last_status: string | null })[]>`
    select s.id, s.filename, s.origin, s.status, s.duration_s, s.width, s.height, s.error, s.created_at,
      (select count(*)::int from clips c where c.source_id = s.id) as clips,
      j.id as last_job, j.status as last_status
    from sources s
    left join lateral (select id, status from jobs where source_id = s.id order by created_at desc limit 1) j on true
    where s.user_id = ${userId}
    order by s.created_at desc limit 100`;
}

export async function getSource(userId: string, id: string): Promise<Source> {
  const [s] = await sql<Source[]>`
    select id, filename, origin, status, duration_s, width, height, error, created_at
    from sources where id = ${id} and user_id = ${userId}`;
  if (!s) throw new HttpError(404, "Vídeo no encontrado.");
  return s;
}

export async function jobsForSource(userId: string, sourceId: string) {
  return sql<Job[]>`select * from jobs where source_id = ${sourceId} and user_id = ${userId} order by created_at desc`;
}

// ---------------------------------------------------------------- jobs

export async function getJob(userId: string, id: string): Promise<Job> {
  const [j] = await sql<Job[]>`select * from jobs where id = ${id} and user_id = ${userId}`;
  if (!j) throw new HttpError(404, "Proyecto no encontrado.");
  return j;
}

export async function clipsForJob(userId: string, jobId: string) {
  return sql<Clip[]>`
    select * from clips where job_id = ${jobId} and user_id = ${userId}
    order by score desc, rank asc`;
}

// ---------------------------------------------------------------- clips

export async function getClip(userId: string, id: string): Promise<Clip> {
  const [c] = await sql<Clip[]>`select * from clips where id = ${id} and user_id = ${userId}`;
  if (!c) throw new HttpError(404, "Clip no encontrado.");
  return c;
}

export async function latestRenders(userId: string, clipId: string) {
  return sql<Render[]>`
    select id, clip_id, clip_version, purpose, format, status, output_path, error, created_at
    from renders where clip_id = ${clipId} and user_id = ${userId}
    order by created_at desc limit 10`;
}

export async function getRender(userId: string, id: string): Promise<Render> {
  const [r] = await sql<Render[]>`
    select id, clip_id, clip_version, purpose, format, status, output_path, error, created_at
    from renders where id = ${id} and user_id = ${userId}`;
  if (!r) throw new HttpError(404, "Exportación no encontrada.");
  return r;
}

export async function sourceDurationForClip(userId: string, clipId: string): Promise<number> {
  const [r] = await sql<{ d: number }[]>`
    select s.duration_s as d from clips c join sources s on s.id = c.source_id
    where c.id = ${clipId} and c.user_id = ${userId}`;
  if (!r) throw new HttpError(404, "Clip no encontrado.");
  return r.d;
}
