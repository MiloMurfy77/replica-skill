import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: postgres.Sql | undefined;
}

export const sql =
  globalThis.__sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://clipper@localhost:5433/clipper", {
    max: 10,
    idle_timeout: 30,
  });

if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
