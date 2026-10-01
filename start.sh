#!/usr/bin/env bash
# Start everything ARIA AI needs, in order, and wait until each is actually
# answering before moving on. Ctrl-C stops the backend and frontend together.
set -uo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1;33m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# ---- 1. Database ---------------------------------------------------------- #
if ! lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  say "Starting PostgreSQL (docker compose)..."
  docker compose up -d db >/dev/null 2>&1 || die "Could not start Postgres. Is Docker Desktop running?"
  for i in $(seq 1 30); do
    lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 1
  done
fi
lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1 || die "Postgres never came up on :5432."
say "PostgreSQL is up."

# ---- 2. Free the ports ---------------------------------------------------- #
# A stale server from a previous run is the usual cause of "Address already in
# use" and of a frontend that cannot reach anything.
for port in 8000 5173; do
  pid=$(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    say "Freeing port $port (stopping PID $pid)..."
    kill $pid 2>/dev/null || true
    sleep 2
  fi
done

# ---- 3. Backend ----------------------------------------------------------- #
say "Starting the backend on :8000..."
( cd backend && ./venv/bin/python -m uvicorn app.main:app --reload --port 8000 ) &
BACKEND_PID=$!

for i in $(seq 1 40); do
  if curl -fsS -m 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS -m 2 http://127.0.0.1:8000/health >/dev/null 2>&1 \
  || die "The backend did not become healthy. Scroll up for its error output."
say "Backend healthy: $(curl -fsS http://127.0.0.1:8000/health)"

# ---- 4. Frontend ---------------------------------------------------------- #
say "Starting the frontend on :5173..."
( cd frontend && npm run dev ) &
FRONTEND_PID=$!

cleanup() {
  echo
  say "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

sleep 4
echo
say "ARIA AI is running:"
echo "      App      http://localhost:5173"
echo "      API docs http://localhost:8000/docs"
echo "      Sign in  demo / demo123"
echo
say "Press Ctrl-C to stop both."
wait
