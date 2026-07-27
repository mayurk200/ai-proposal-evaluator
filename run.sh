#!/usr/bin/env bash
#
# AgriEval — start the whole system with one command.
#
#   ./run.sh              start everything (installs what's missing on first run)
#   ./run.sh --stop       stop the services and the containers
#   ./run.sh --clean      stop, and DESTROY the database and stored files
#   ./run.sh --setup      install dependencies and prepare, but do not start
#   ./run.sh --no-docker  use a Postgres you are already running yourself
#
# Ctrl+C stops everything cleanly.
#
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$PWD"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'
  BLU=$'\e[34m'; RST=$'\e[0m'
else
  BOLD=""; DIM=""; RED=""; GRN=""; YEL=""; BLU=""; RST=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$BLU" "$RST" "$BOLD" "$1" "$RST"; }
ok()   { printf '    %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '    %s!%s %s\n' "$YEL" "$RST" "$1"; }
info() { printf '    %s%s%s\n' "$DIM" "$1" "$RST"; }
die()  { printf '\n%serror:%s %s\n\n' "$RED" "$RST" "$1" >&2; exit 1; }

MODE="start"
USE_DOCKER=1
for arg in "$@"; do
  case "$arg" in
    --stop)      MODE="stop" ;;
    --clean)     MODE="clean" ;;
    --setup)     MODE="setup" ;;
    --no-docker) USE_DOCKER=0 ;;
    -h|--help)   sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *)           die "unknown option: $arg (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# docker compose — the v2 plugin and the v1 standalone take different argv.
# ---------------------------------------------------------------------------
DC=""
if [[ $USE_DOCKER -eq 1 ]]; then
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
  fi
fi

# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------
PIDS=()
CLEANING=0

cleanup() {
  # Ctrl+C is delivered to the whole process group, so this can fire twice.
  [[ $CLEANING -eq 1 ]] && return
  CLEANING=1

  printf '\n'
  step "Shutting down"
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # Kill the process GROUP: npm and uvicorn --reload both spawn children that
      # would otherwise survive and keep the ports bound.
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    fi
  done
  sleep 1
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    fi
  done
  ok "services stopped"
  info "containers are still running — './run.sh --stop' to stop them too"
  exit 0
}
trap cleanup INT TERM

stop_all() {
  step "Stopping"

  # Match on this repo's paths, not on bare process names, so we never take down a
  # vite or uvicorn belonging to some other project on the same machine.
  #
  # The patterns are order-sensitive: vite's real command line is
  #   node /…/frontend/node_modules/.bin/vite --port 5173
  # so the path comes BEFORE the word "vite". An earlier "vite.*frontend" pattern
  # matched nothing and left the dev server holding port 5173 after --stop.
  pkill -f "uvicorn app.main:app"                2>/dev/null && ok "python service stopped" || true
  pkill -f "$ROOT/backend.*tsx|tsx.*src/server"  2>/dev/null && ok "gateway stopped"        || true

  # Kill the npm/sh wrappers as well as the node process itself — otherwise the
  # supervisor respawns it.
  pkill -f "$ROOT/frontend/node_modules.*vite"   2>/dev/null || true
  pkill -f "npm exec vite"                       2>/dev/null || true
  pkill -f "sh -c vite --port"                   2>/dev/null || true
  ok "frontend stopped"
  if [[ -n "$DC" ]]; then
    if [[ "$MODE" == "clean" ]]; then
      $DC down -v >/dev/null 2>&1 && ok "containers and volumes destroyed"
      rm -rf "$ROOT/python-service/uploads" "$LOGS"
      ok "stored files removed"
      warn "the database is gone — the next run starts from empty"
    else
      $DC down >/dev/null 2>&1 && ok "containers stopped (data kept)"
    fi
  fi
  printf '\n'
}

if [[ "$MODE" == "stop" || "$MODE" == "clean" ]]; then
  stop_all
  exit 0
fi

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Need v18+: https://nodejs.org"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 18 )) || die "Node.js $(node -v) is too old. Need v18 or newer."
ok "node $(node -v)"

PY=""
for candidate in python3.12 python3.11 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    ver=$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null) || continue
    major=${ver%%.*}; minor=${ver##*.}
    if (( major == 3 && minor >= 11 )); then PY="$candidate"; break; fi
  fi
done
[[ -n "$PY" ]] || die "Python 3.11+ is not installed. https://www.python.org/downloads/"
ok "python $($PY -V 2>&1 | cut -d' ' -f2) ($PY)"

if [[ $USE_DOCKER -eq 1 ]]; then
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. https://docs.docker.com/get-docker/
(Or run with --no-docker if you have your own Postgres with the pgvector extension.)"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop / the daemon."
  [[ -n "$DC" ]] || die "Neither 'docker compose' nor 'docker-compose' is available."
  ok "docker is running"
fi

if command -v tesseract >/dev/null 2>&1; then
  ok "tesseract $(tesseract --version 2>&1 | head -1 | cut -d' ' -f2)"
else
  warn "tesseract is not installed — scanned PDFs and images will not be OCR'd."
  info "install: sudo apt install tesseract-ocr   (or: brew install tesseract)"
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
step "Configuration"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn "created .env from .env.example"
  die "Set GROQ_API_KEY in .env, then run this again.
Get a key at https://console.groq.com/keys"
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

[[ -n "${GROQ_API_KEY:-}" ]] || die "GROQ_API_KEY is empty in .env
Get a key at https://console.groq.com/keys"

: "${FRONTEND_PORT:=5173}"; : "${GATEWAY_PORT:=3001}"; : "${PYTHON_PORT:=8000}"
: "${POSTGRES_USER:=agrieval}"; : "${POSTGRES_PASSWORD:=agrieval123}"
: "${POSTGRES_DB:=agrieval}";   : "${POSTGRES_PORT:=5432}"
: "${STORAGE_PROVIDER:=local}"; : "${MINIO_PORT:=9000}"
: "${LLM_TPM:=12000}";          : "${LLM_TPM_FAST:=6000}"
: "${JWT_SECRET:=change-this-to-a-long-random-string}"

PG_HOST_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"

ok "loaded .env"

# The two services read their own .env files. Generate them from the root one so
# there is exactly one place to edit and no chance of the three drifting apart.
cat > "$ROOT/python-service/.env" <<EOF
# GENERATED by run.sh from the root .env — do not edit; your changes will be overwritten.
PORT=${PYTHON_PORT}
ENV=development
LOG_LEVEL=${LOG_LEVEL:-INFO}

GROQ_API_KEY=${GROQ_API_KEY}
LLM_MODEL=llama-3.3-70b-versatile
LLM_MODEL_FAST=llama-3.1-8b-instant
LLM_TPM=${LLM_TPM}
LLM_TPM_FAST=${LLM_TPM_FAST}

DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}

STORAGE_PROVIDER=${STORAGE_PROVIDER}
STORAGE_LOCAL_DIR=./uploads
S3_BUCKET_NAME=${S3_BUCKET_NAME:-agrieval-uploads}
S3_ACCESS_KEY=${MINIO_ROOT_USER:-minioadmin}
S3_SECRET_KEY=${MINIO_ROOT_PASSWORD:-minioadmin}
S3_ENDPOINT_URL=http://localhost:${MINIO_PORT}
S3_REGION=us-east-1

OCR_ENABLED=true
OCR_LANGUAGE=eng
$( [[ -n "${TESSERACT_CMD:-}" ]] && echo "TESSERACT_CMD=${TESSERACT_CMD}" )
EOF

cat > "$ROOT/backend/.env" <<EOF
# GENERATED by run.sh from the root .env — do not edit; your changes will be overwritten.
NODE_ENV=development
PORT=${GATEWAY_PORT}
JWT_SECRET=${JWT_SECRET}

# The gateway uses the plain (psycopg-style) URL; the Python service uses +asyncpg.
DATABASE_URL=${PG_HOST_URL}
PYTHON_SERVICE_URL=http://localhost:${PYTHON_PORT}

ADMIN_EMAIL=${ADMIN_EMAIL:-admin@agrieval.local}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-ChangeMe!Admin1}
DESK2_EMAIL=${DESK2_EMAIL:-desk2@agrieval.local}
DESK2_PASSWORD=${DESK2_PASSWORD:-ChangeMe!Desk2}

STORAGE_PROVIDER=${STORAGE_PROVIDER}
MAX_FILE_SIZE=52428800
EOF

ok "generated backend/.env and python-service/.env"

if [[ "${ADMIN_PASSWORD:-}" == ChangeMe!* || "${DESK2_PASSWORD:-}" == ChangeMe!* ]]; then
  warn "using the default operator passwords — change them in .env before deploying"
fi

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------
if [[ $USE_DOCKER -eq 1 ]]; then
  step "Starting Postgres${STORAGE_PROVIDER:+ and MinIO}"

  SERVICES="postgres"
  [[ "$STORAGE_PROVIDER" == "minio" ]] && SERVICES="postgres minio"

  $DC up -d $SERVICES >/dev/null 2>&1 || die "docker compose failed to start. Try: $DC up postgres"

  printf '    waiting for postgres'
  PG_READY=0
  for _ in $(seq 1 60); do
    if $DC exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      PG_READY=1; break
    fi

    # A crash-looping container will never become ready, and waiting the full minute to
    # tell the user that is unkind. The overwhelmingly common cause is a data directory
    # left behind by an older Postgres major version, so name it explicitly instead of
    # making them go and read docker logs.
    PG_LOGS=$(docker logs agrieval-postgres 2>&1 | tail -20)
    if grep -q "are incompatible with server" <<<"$PG_LOGS"; then
      printf '\r'
      OLD_VER=$(grep -oP 'initialized by PostgreSQL version \K[0-9]+' <<<"$PG_LOGS" | head -1)
      die "Postgres cannot start: the existing database volume was created by
PostgreSQL ${OLD_VER:-an older version}, and this image is PostgreSQL 16.

This is expected if you ran an earlier version of AgriEval, which used
postgres:15-alpine. That image has no pgvector extension, so the duplicate-idea
gate cannot work against it — hence the upgrade.

To reset the database and start clean:

    ${BOLD}./run.sh --clean && ./run.sh${RST}

${YEL}This destroys the existing database.${RST} If it holds evaluations you need, dump
them first — but note that the old schema is not compatible with this one, so
they cannot be imported as-is:

    docker run --rm -v agrieval_postgres-data:/v -v \"\$PWD\":/out alpine \\
      tar czf /out/postgres-backup.tgz -C /v ."
    fi

    printf '.'; sleep 1
  done

  printf '\r'
  (( PG_READY )) || die "postgres did not become ready. Logs: $DC logs postgres"
  ok "postgres ready on :$POSTGRES_PORT                              "

  # The similarity gate is an HNSW index over a vector column, so pgvector is not
  # optional. Fail here, with a clear message, rather than deep inside a CREATE TABLE.
  if ! $DC exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
       -c "CREATE EXTENSION IF NOT EXISTS vector" >/dev/null 2>&1; then
    die "This Postgres does not have the pgvector extension.
docker-compose.yml pins pgvector/pgvector:pg16 for exactly this reason — do not
swap it for a stock postgres image."
  fi
  ok "pgvector extension available"

  if [[ "$STORAGE_PROVIDER" == "minio" ]]; then
    ok "minio on :$MINIO_PORT (console :${MINIO_CONSOLE_PORT:-9001})"
  fi
else
  info "skipping docker — expecting Postgres at localhost:${POSTGRES_PORT}"
fi

# ---------------------------------------------------------------------------
# Python service
# ---------------------------------------------------------------------------
step "Python AI service"

cd "$ROOT/python-service"
VENV="$ROOT/python-service/venv"
STAMP="$VENV/.requirements.sha"

if [[ ! -d "$VENV" ]]; then
  info "creating virtualenv (first run)"
  "$PY" -m venv venv || die "could not create the virtualenv.
On Debian/Ubuntu you may need: sudo apt install python3-venv"
fi

VPY="$VENV/bin/python"
CURRENT_SHA=$(sha256sum requirements.txt | cut -d' ' -f1)

# Only reinstall when requirements.txt has actually changed. pip is slow and this
# script is meant to be run every day.
if [[ ! -f "$STAMP" ]] || [[ "$(cat "$STAMP" 2>/dev/null)" != "$CURRENT_SHA" ]]; then
  info "installing python dependencies (a few minutes on first run)"
  "$VPY" -m pip install --quiet --upgrade pip
  "$VPY" -m pip install --quiet -r requirements.txt || die "pip install failed. See the output above."
  echo "$CURRENT_SHA" > "$STAMP"
  ok "dependencies installed"
else
  ok "dependencies up to date"
fi

# tiktoken fetches its encoding over the network on first use, and fastembed
# downloads a ~130MB model. Doing it here — with a message — beats having the
# user's first upload mysteriously hang for half a minute.
if [[ ! -f "$VENV/.models-warmed" ]]; then
  info "downloading tokenizer and embedding model (one time, ~130MB)"
  "$VPY" - <<'PYEOF' >/dev/null 2>&1 && touch "$VENV/.models-warmed"
import tiktoken
tiktoken.get_encoding("cl100k_base").encode("warm")
from fastembed import TextEmbedding
list(TextEmbedding(model_name="BAAI/bge-small-en-v1.5").embed(["warm"]))
PYEOF
  [[ -f "$VENV/.models-warmed" ]] && ok "models cached" || warn "model pre-warm failed; the first upload will be slower"
fi

if [[ "$MODE" == "setup" ]]; then
  cd "$ROOT/backend" && npm install --silent
  cd "$ROOT/frontend" && npm install --silent
  step "Setup complete"
  info "run ./run.sh to start"
  exit 0
fi

# The Python service owns the schema. It must be up — and have created the tables —
# before the gateway's seed script can insert users.
PYTHONPATH="$ROOT/python-service" nohup "$VPY" -m uvicorn app.main:app \
  --host 0.0.0.0 --port "$PYTHON_PORT" > "$LOGS/python.log" 2>&1 &
PIDS+=($!)

printf '    waiting for the AI service'
READY=0
for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:${PYTHON_PORT}/api/v1/health" >/dev/null 2>&1; then
    READY=1; break
  fi
  printf '.'; sleep 1
done
printf '\r'
(( READY )) || { tail -25 "$LOGS/python.log"; die "the AI service did not start. Full log: $LOGS/python.log"; }
ok "AI service ready on :$PYTHON_PORT                    "

# ---------------------------------------------------------------------------
# Gateway
# ---------------------------------------------------------------------------
step "API gateway"

cd "$ROOT/backend"
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]]; then
  info "installing node dependencies"
  npm install --silent || die "npm install failed in backend/"
fi
ok "dependencies ready"

# Idempotent: it upserts by email and never resets a password that has been changed.
info "seeding operator accounts"
npm run seed 2>&1 | grep -E "created|exists|updated|WARNING" | sed 's/^/    /' || true

nohup npx tsx src/server.ts > "$LOGS/gateway.log" 2>&1 &
PIDS+=($!)

printf '    waiting for the gateway'
READY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${GATEWAY_PORT}/api/health" >/dev/null 2>&1; then
    READY=1; break
  fi
  printf '.'; sleep 1
done
printf '\r'
(( READY )) || { tail -25 "$LOGS/gateway.log"; die "the gateway did not start. Full log: $LOGS/gateway.log"; }
ok "gateway ready on :$GATEWAY_PORT                      "

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
step "Frontend"

cd "$ROOT/frontend"
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]]; then
  info "installing node dependencies"
  npm install --silent || die "npm install failed in frontend/"
fi
ok "dependencies ready"

nohup npx vite --port "$FRONTEND_PORT" --host > "$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

printf '    waiting for the frontend'
READY=0
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; then
    READY=1; break
  fi
  printf '.'; sleep 1
done
printf '\r'
(( READY )) || { tail -25 "$LOGS/frontend.log"; die "the frontend did not start. Full log: $LOGS/frontend.log"; }
ok "frontend ready on :$FRONTEND_PORT                    "

# ---------------------------------------------------------------------------
# Ready
# ---------------------------------------------------------------------------
cat <<EOF

${GRN}${BOLD}AgriEval is running.${RST}

    ${BOLD}Open  http://localhost:${FRONTEND_PORT}${RST}

    ${DIM}gateway   http://localhost:${GATEWAY_PORT}/api/health
    AI docs   http://localhost:${PYTHON_PORT}/docs${RST}

  ${BOLD}Sign in${RST}
    admin   ${ADMIN_EMAIL:-admin@agrieval.local}   ${ADMIN_PASSWORD:-ChangeMe!Admin1}
    ${DIM}decides: duplicate gate, approve/reject, funding${RST}
    desk2   ${DESK2_EMAIL:-desk2@agrieval.local}   ${DESK2_PASSWORD:-ChangeMe!Desk2}
    ${DIM}uploads, processes, retries, reads — cannot decide${RST}

  ${DIM}logs      $LOGS/{python,gateway,frontend}.log
  stop      Ctrl+C  (containers keep running; './run.sh --stop' stops those too)${RST}

  ${YEL}Note:${RST} on Groq's free tier an evaluation takes ~4 minutes — nearly all of it
  waiting on the token budget. Raise LLM_TPM in .env when you raise your tier.

EOF

# Hold the terminal open so Ctrl+C reaches the trap.
wait
