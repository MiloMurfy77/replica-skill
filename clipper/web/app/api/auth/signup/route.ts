import { z } from "zod";
import { createSession, FREE_MINUTES, hashPassword } from "@/lib/auth";
import { sql } from "@/lib/db";
import { json } from "@/lib/http";

const Body = z.object({
  email: z.string().trim().toLowerCase().email("Email no válido.").max(200),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres.").max(200),
  name: z.string().trim().max(80).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
  const { email, password, name } = parsed.data;
  const hash = await hashPassword(password);
  const rows = await sql<{ id: string }[]>`
    insert into users (email, password_hash, name) values (${email}, ${hash}, ${name ?? null})
    on conflict (lower(email)) do nothing returning id`;
  if (!rows[0]) return json({ error: "Ya existe una cuenta con ese email." }, 409);
  await sql`insert into usage_ledger (user_id, delta_min, reason) values (${rows[0].id}, ${FREE_MINUTES}, 'grant')`;
  await createSession(rows[0].id);
  return json({ ok: true });
}
