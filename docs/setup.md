# Local Development Setup

Complete guide for running the AI Proposal Evaluator locally on Windows.
For a condensed run order (once already set up), see [RUN.md](RUN.md).

## Architecture at a glance

| Component      | Runs as                       | Port | Started by |
|----------------|-------------------------------|------|------------|
| PostgreSQL 15  | Docker (`agrieval-postgres`)  | 5432 | `docker compose` |
| MinIO          | Docker (`agrieval-minio`)     | 9000 (API), 9001 (console) | `docker compose` |
| createbuckets  | Docker one-shot (`agrieval-createbuckets`) | – | `docker compose` |
| Python service | Host (uvicorn, Python 3.11)   | 8000 | `scripts\dev.ps1` |
| Backend (Node) | Host (`npm run dev`)          | 3001 | `scripts\dev.ps1` |
| Frontend (Vite)| Host (`npm run dev`)          | 5173 | `scripts\dev.ps1` |

## Prerequisites

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
   (must be running before startup).
2. **Node.js 20+** — https://nodejs.org/ (`node --version` to check).
3. **uv** (Python manager) — installs and manages Python **independently of
   any system Python**, which matters on this machine (see
   [Troubleshooting](#broken-system-python)):

   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```

   The required Python version is **3.11** (pinned in
   `python-service/.python-version`); uv downloads it automatically when the
   venv is created. Do **not** use `python`/`py` from PATH.
4. **A Groq API key** — https://console.groq.com/keys (free tier works).
5. Optional: **Tesseract OCR** for image-based documents —
   https://github.com/UB-Mannheim/tesseract/wiki. Without it the Python
   service starts with a WARN and image files can't be processed.

## Configuration (single source of truth)

Shared values live in the **root `.env`** — database credentials, `DATABASE_URL`,
MinIO endpoint + credentials, `GROQ_API_KEY`, `JWT_SECRET`. It is read by
docker-compose (variable substitution), the backend, and the Python service.

Service-specific values (ports, log levels, model knobs) live in
`backend/.env` and `python-service/.env`. If a key appears in both a service
file and the root file, **the service file wins**; real OS environment
variables beat both.

First-time setup:

```powershell
copy .env.example .env                                # then fill in GROQ_API_KEY + JWT_SECRET
copy backend\.env.example backend\.env                # defaults are fine
copy python-service\.env.example python-service\.env  # defaults are fine
```

### Environment variable reference (root `.env`)

| Variable | Used by | Purpose |
|---|---|---|
| `GROQ_API_KEY` | backend, python | LLM API key (required) |
| `JWT_SECRET` | backend | Token signing (required, 10+ chars) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Seed the DB container **on first volume init only** |
| `DATABASE_URL` | backend, python | `postgresql+asyncpg://user:pass@localhost:5432/db` — must match `POSTGRES_*`; backend strips `+asyncpg` automatically |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | compose | MinIO credentials |
| `MINIO_ENDPOINT` / `MINIO_PUBLIC_ENDPOINT` | backend | MinIO S3 API / browser-facing URL |
| `S3_ENDPOINT_URL` | python | Same MinIO endpoint (python naming) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | backend | Must equal `MINIO_ROOT_*` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | python | Must equal `MINIO_ROOT_*` |
| `S3_BUCKET` | backend, compose | Upload bucket (`proposals`) |
| `S3_BUCKET_NAME` | python | Python artifact bucket (`agrieval-uploads`) |

## Starting everything (one command)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

The script verifies prerequisites, starts and health-gates the containers,
**self-heals the PostgreSQL password** (see below), validates/recreates the
Python venv with uv, installs missing node_modules, then starts the Python
service → backend → frontend, each gated on the previous one's health
endpoint. Each service gets its own console window.

Stop everything:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

### Manual startup (what the script does)

```powershell
docker compose up -d postgres minio createbuckets

cd python-service
uv venv venv --python 3.11               # only if venv is missing/broken
uv pip install -r requirements.txt --python .\venv\Scripts\python.exe
.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

cd ..\backend
npm install
npm run dev

cd ..\frontend
npm install
npm run dev
```

The Python service prints a **preflight PASS/FAIL report** at startup
(config, PostgreSQL, schema, MinIO, GROQ, OCR, writable dirs) and **refuses to
start** if a hard dependency fails. The backend prints a readiness summary and
exits if `DATABASE_URL` is set but PostgreSQL is unreachable.

### Health endpoints

- Python service: `http://localhost:8000/api/v1/health` (503 when DB/storage down)
- Backend: `http://localhost:3001/api/health` (503 when DB down; also reports MinIO + Python service)

## PostgreSQL access

```powershell
# psql inside the container (no password needed — local connections are trusted):
docker exec -it agrieval-postgres psql -U agrieval -d agrieval

# From the host (password from root .env):
psql "postgresql://agrieval:agrieval123@localhost:5432/agrieval"
```

### pgAdmin setup

Register a server with: Host `localhost`, Port `5432`, Maintenance DB
`agrieval`, Username `agrieval`, Password = `POSTGRES_PASSWORD` from the root
`.env`. If you have a **native PostgreSQL installed**, make sure its service is
stopped first (see Troubleshooting) or pgAdmin may silently connect to the
wrong server.

### Password reset

`POSTGRES_PASSWORD` in `.env`/compose is only applied when the `postgres-data`
volume is **first created**. If the volume already exists with a different
password you get `password authentication failed for user "agrieval"` even
though every config file looks right. Fix (data-preserving — `scripts\dev.ps1`
does this automatically):

```powershell
docker exec agrieval-postgres psql -U agrieval -d agrieval -c "ALTER USER agrieval WITH PASSWORD 'agrieval123';"
```

(Use the password from your root `.env`.) The nuclear option — wipe data and
re-init from env: `docker compose down -v` then `docker compose up -d`.

## Troubleshooting

### `password authentication failed for user "agrieval"`
The Docker volume was initialized with a different password than the current
`.env`. Run `scripts\dev.ps1` (self-heals) or the [Password reset](#password-reset)
command above. Note: `docker exec psql` working does NOT prove the password is
right — connections inside the container are trusted without a password.

### Broken system Python
On this machine `python` resolves to the Microsoft Store stub and `py` points
at a deleted interpreter (`E:\gen_ai\python.exe`). **Nothing in this project
uses them.** All Python runs through `python-service\venv\Scripts\python.exe`,
created by uv with its own managed CPython 3.11. If the venv breaks, delete
`python-service\venv` and run `scripts\dev.ps1` — it recreates it.
To also fix the machine (optional): Settings → Apps → Advanced app settings →
App execution aliases → disable the `python.exe`/`python3.exe` aliases, and
uninstall/repair the broken Python launcher.

### Something else answers on port 5432
A native PostgreSQL (e.g. `postgresql-x64-18` Windows service) or a Postgres
inside WSL can shadow the Docker container on `localhost:5432` — auth failures
then come from the *wrong server*. Check:

```powershell
Get-Service postgresql*            # should be Stopped / Manual
netstat -ano | findstr :5432       # expect com.docker.backend (+ wslrelay on [::1], which is Docker's own relay)
```

Stop and de-autostart a native instance:
`Stop-Service postgresql-x64-18; Set-Service postgresql-x64-18 -StartupType Manual`.

### Python service exits immediately at startup
That is the preflight doing its job — read the PASS/FAIL report in its window.
Each FAIL line names the dependency, the reason, and where to fix it.

### `uvicorn` not found / import errors in the venv
The venv is broken (e.g. its base interpreter was deleted). Delete
`python-service\venv` and rerun `scripts\dev.ps1`.

### Uploads fail from the frontend
Check `http://localhost:3001/api/health` — it reports `database`, `storage`
(MinIO), and `python_service` individually, so the failing dependency is named.

### MinIO console
`http://localhost:9001`, login with `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`
from the root `.env` (default `minioadmin`/`minioadmin`). Uploaded files are in
the `proposals` bucket; Python-service artifacts in `agrieval-uploads`.

### Runtime settings overrides
The Settings page persists overrides to `python-service/runtime_settings.json`,
which are re-applied at startup and can shadow `.env` values (including
`DATABASE_URL`). The preflight report WARNs when this file is in effect —
delete it to return to pure `.env` config.
