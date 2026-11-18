import { z } from "zod";
import { createSession, verifyPassword } from "@/lib/auth";
import { sql } from "@/lib/db";
import { json } from "@/lib/http";

const Body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "Faltan datos." }, 400);
  const [u] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from users where lower(email) = ${parsed.data.email}`;
  const ok = u ? await verifyPassword(parsed.data.password, u.password_hash) : false;
  if (!u || !ok) return json({ error: "Email o contraseña incorrectos." }, 401);
  await createSession(u.id);
  return json({ ok: true });
}
