# Running the Full Stack

Everything needed to bring up the AI Proposal Evaluator locally for development.
**First-time setup (prerequisites, .env layout, troubleshooting): see [setup.md](setup.md).**

## One command

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

That verifies prerequisites, starts + health-gates the Docker containers,
self-heals the PostgreSQL password, validates/recreates the Python venv (uv,
Python 3.11), installs missing node_modules, and starts all three host
services in their own windows — each gated on the previous one's health check.
Stop everything with `scripts\stop.ps1`.

The rest of this document is the manual, step-by-step equivalent.

| # | Component        | How it runs                  | Port | Depends on          |
|---|------------------|------------------------------|------|---------------------|
| 1 | PostgreSQL       | Docker (`agrieval-postgres`) | 5432 | Docker Desktop      |
| 1 | MinIO            | Docker (`agrieval-minio`)    | 9000 (API), 9001 (console) | Docker Desktop |
| 2 | Python service   | host, uvicorn + venv         | 8000 | Postgres, MinIO     |
| 3 | Node backend     | host, `npm run dev`          | 3001 | Postgres, MinIO, Python service |
| 4 | React frontend   | host, `npm run dev` (Vite)   | 5173 | Node backend        |

## Configuration

Shared values (secrets, `DATABASE_URL`, MinIO credentials) live in the **root
`.env`** — the single source of truth, read by docker-compose, the backend, and
the Python service. `backend/.env` and `python-service/.env` hold only
service-specific settings and win over the root file for duplicated keys.
Templates: `.env.example`, `backend/.env.example`, `python-service/.env.example`.

## 1. Infrastructure (Docker)

From the repository root:

```powershell
docker compose up -d postgres minio createbuckets
```

This starts:
- **PostgreSQL** on `localhost:5432` (credentials from the root `.env`)
- **MinIO** on `localhost:9000` (S3 API) and `localhost:9001` (web console)
- **createbuckets** — a one-shot init container that creates the `proposals` bucket with public-read and exits

Check health before continuing:

```powershell
docker ps --format "{{.Names}}`t{{.Status}}"
```

> `POSTGRES_PASSWORD` only takes effect when the `postgres-data` volume is
> first created. If auth fails against an older volume, see
> [setup.md → Password reset](setup.md#password-reset) (`scripts\dev.ps1`
> self-heals this automatically).

## 2. Python service (port 8000)

```powershell
cd python-service
# First time only (uses uv — NOT the system python, which is broken on this machine):
uv venv venv --python 3.11
uv pip install -r requirements.txt --python .\venv\Scripts\python.exe

.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

On startup it runs a **preflight check** (config, PostgreSQL, schema init +
verification, MinIO, GROQ key, OCR, writable dirs), prints a PASS/FAIL report,
and **exits if any hard dependency fails** — a failed start names the exact
problem instead of degrading into 500s later.

Verify: <http://localhost:8000/api/v1/health> should return 200 with
`"database": "connected"` and `"storage": "minio (ok)"`. It returns **503**
when the database or storage is down.
(`tesseract_ocr: unavailable` is fine — EasyOCR is the fallback.)

## 3. Node backend (port 3001)

```powershell
cd backend
npm install        # first time only
npm run dev
```

The boot log prints a readiness summary — you want:

```
[startup] PostgreSQL:     connected
[startup] Storage:        minio (ok)
[startup] Python service: connected (http://localhost:8000)
```

If `DATABASE_URL` is set but PostgreSQL is unreachable the backend **exits
with an explanatory error** instead of silently falling back to the JSON store.

Verify: <http://localhost:3001/api/health> returns 200 with per-dependency
statuses (`database`, `storage`, `python_service`); 503 when the DB is down.

> `npm run dev` uses tsx watch: it hot-reloads on **source** changes but does
> **not** re-read `.env` — restart it after any `.env` edit.

## 4. Frontend (port 5173)

```powershell
cd frontend
npm install        # first time only
npm run dev
```

Open <http://localhost:5173>.

## Smoke-test the whole pipeline

1. Register/login in the UI.
2. **Upload** page → drop a file → it should appear in the *All Files* tab
   (stored in MinIO under `proposals/`).
3. Select it → **Send for processing** → extraction + agri categorization runs
   on the Python service (needs the Groq key).
4. **Proposals** page → the file appears with status `categorizing` → `categorized`.
5. Click **More info** on the row → full record: file metadata, extraction
   stats, the exact text the agent analyzed, and the agent's complete output.

## Tests

```powershell
cd backend
npm test                                        # vitest suite

cd ..\python-service
.\venv\Scripts\python.exe -m pytest             # python suite
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `password authentication failed for user "agrieval"` | Stale volume password — run `scripts\dev.ps1` (self-heals) or see [setup.md → Password reset](setup.md#password-reset). |
| Python service exits at startup with a FAIL report | Working as intended — the report names the broken dependency and the fix. |
| *All Files* tab always empty, even after uploading | `STORAGE_PROVIDER=local` in `backend/.env` — set it to `minio` and **restart** the backend. |
| Backend health shows `database: disconnected` | Postgres container down (`docker compose up -d postgres`) — or the native Windows PostgreSQL service grabbed port 5432. Keep `postgresql-x64-18` **Stopped** (StartType Manual); the Docker container owns 5432. |
| `EADDRINUSE :::3001` | A backend instance is already running — don't start a second one. |
| MinIO console won't open / uploads fail | Docker Desktop isn't running. Everything in step 1 requires it. |
| Changed `.env` but behavior didn't change | tsx watch and uvicorn don't watch `.env`. Restart the process. Also check `python-service/runtime_settings.json` overrides (preflight WARNs about them). |
| `python` / `py` commands broken on the host | Irrelevant to this project — everything uses `python-service\venv` via uv. See [setup.md → Broken system Python](setup.md#broken-system-python). |

## Alternative: backend in Docker

The compose backend is behind the `full` profile so it can't fight the host
dev backend over port 3001 by default:

```powershell
docker compose --profile full up -d
```

It runs the production build with `STORAGE_PROVIDER=minio` and
`DATABASE_URL` pointing at the compose Postgres. The Python service and
frontend are not part of the compose file and always run on the host.
