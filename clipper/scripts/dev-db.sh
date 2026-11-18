#!/usr/bin/env bash
# Arranca un Postgres local para desarrollo y aplica las migraciones.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-$ROOT/.data/pg}"
PORT="${PGPORT:-5433}"
mkdir -p "$ROOT/.data"
# initdb no puede ejecutarse como root: en ese caso usamos el usuario postgres
AS=()
if [ "$(id -u)" = "0" ]; then
  AS=(runuser -u postgres --)
  mkdir -p "$PGDATA" && chown -R postgres "$ROOT/.data"
fi
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "${AS[@]}" "$PGBIN/initdb" -D "$PGDATA" -U clipper --auth=trust -E UTF8 --no-locale >/dev/null
fi
if ! "${AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -l "$ROOT/.data/pg.log" start >/dev/null
fi
sleep 1
psql -h localhost -p "$PORT" -U clipper -d postgres -tc "select 1 from pg_database where datname='clipper'" | grep -q 1 \
  || psql -h localhost -p "$PORT" -U clipper -d postgres -c "create database clipper encoding 'UTF8' template template0" >/dev/null
psql -h localhost -p "$PORT" -U clipper -d clipper -c "create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())" >/dev/null
for f in "$ROOT"/db/migrations/*.sql; do
  n="$(basename "$f")"
  if ! psql -h localhost -p "$PORT" -U clipper -d clipper -tc "select 1 from schema_migrations where name='$n'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U clipper -d clipper -f "$f" >/dev/null
    psql -h localhost -p "$PORT" -U clipper -d clipper -c "insert into schema_migrations(name) values ('$n')" >/dev/null
    echo "migración aplicada: $n"
  fi
done
echo "DATABASE_URL=postgres://clipper@localhost:$PORT/clipper"
