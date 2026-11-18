#!/usr/bin/env bash
# Arranca base de datos, web (http://localhost:3000) y worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/dev-db.sh"
export DATABASE_URL="${DATABASE_URL:-postgres://clipper@localhost:5433/clipper}"
(cd "$ROOT/worker" && PYTHONPATH="$PWD" "$ROOT/.venv/bin/python" -m clipper_worker.main) &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT
cd "$ROOT/web" && pnpm dev
