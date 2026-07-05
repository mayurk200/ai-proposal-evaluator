# Running the Full Stack

Everything needed to bring up the AI Proposal Evaluator locally for development.
Start the pieces **in this order** — later services depend on earlier ones.

| # | Component        | How it runs                  | Port | Depends on          |
|---|------------------|------------------------------|------|---------------------|
| 1 | PostgreSQL       | Docker (`agrieval-postgres`) | 5432 | Docker Desktop      |
| 1 | MinIO            | Docker (`agrieval-minio`)    | 9000 (API), 9001 (console) | Docker Desktop |
| 2 | Python service   | host, uvicorn + venv         | 8000 | Postgres, MinIO     |
| 3 | Node backend     | host, `npm run dev`          | 3001 | Postgres, MinIO, Python service |
| 4 | React frontend   | host, `npm run dev` (Vite)   | 5173 | Node backend        |

## Prerequisites

- **Docker Desktop** (running — the whole stack depends on it)
- **Node.js** 18+ and npm
- **Python** 3.11+ with the venv at `python-service/venv` (see step 2 if it doesn't exist)
- A **Groq API key** for the LLM (used by the Python service, and optionally by the backend)

## 1. Infrastructure (Docker)

From the repository root:

```powershell
docker compose up -d minio createbuckets postgres
```

This starts:
- **PostgreSQL** on `localhost:5432` (user `agrieval`, password `agrieval123`, database `agrieval`)
- **MinIO** on `localhost:9000` (S3 API) and `localhost:9001` (web console, login `minioadmin` / `minioadmin`)
- **createbuckets** — a one-shot init container that creates the `proposals` bucket with public-read and exits

Check both are healthy before continuing:

```powershell
docker ps --format "{{.Names}}`t{{.Status}}"
```

## 2. Python service (port 8000)

```powershell
cd python-service
# First time only: create the venv and install dependencies
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

Configure `python-service/.env` (copy from a teammate or fill the keys below):

```ini
PORT=8000
ENV=development
LLM_PROVIDER=groq
GROQ_API_KEY=<your key>
LLM_MODEL=llama-3.3-70b-versatile
STORAGE_PROVIDER=minio
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
DATABASE_URL=postgresql+asyncpg://agrieval:agrieval123@localhost:5432/agrieval
```

Start it:

```powershell
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

On startup it creates its database tables (`proposals`, `evaluations`) automatically.
**Important:** Postgres must already be up — if table creation fails you only get a
log *warning* (`database_init_failed`), and every `/proposals` request will then
return 500 until you restart the service.

Verify: <http://localhost:8000/api/v1/health> should show
`"database": "connected"` and `"storage": "minio (ok)"`.
(`tesseract_ocr: unavailable` is fine — EasyOCR is the fallback.)

## 3. Node backend (port 3001)

```powershell
cd backend
npm install        # first time only
```

Configure `backend/.env` (start from `backend/.env.example`). The keys that matter:

```ini
PORT=3001
JWT_SECRET=<any dev secret>
PYTHON_SERVICE_URL=http://localhost:8000

# Storage — MUST be "minio" or uploaded files will silently go to local disk
# and the All Files list will always be empty:
STORAGE_PROVIDER=minio
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
S3_BUCKET=proposals

# Database — Postgres document store (falls back to a local JSON store if unset)
DATABASE_URL=postgresql://agrieval:agrieval123@localhost:5432/agrieval
```

Start it:

```powershell
npm run dev
```

The boot log tells you which stores are active — you want:

```
🐘 PostgreSQL configured — using Postgres document store
```

Verify: <http://localhost:3001/api/health> should show `"database": "connected"`.

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
npm test               # vitest suite
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| *All Files* tab always empty, even after uploading | `STORAGE_PROVIDER=local` in `backend/.env` — set it to `minio` and **restart** the backend. |
| Proposals page: `Could not fetch processed proposals … (500)` | Python service was started before Postgres, so its tables were never created. Start Docker first, then **restart** the Python service; health must say `database: connected`. |
| Backend health shows `database: disconnected` | Postgres container down (`docker compose up -d postgres`) — or the native Windows PostgreSQL service grabbed port 5432. Keep `postgresql-x64-18` **Stopped** (StartType Manual); the Docker container owns 5432. |
| `EADDRINUSE :::3001` | A backend instance is already running — don't start a second one. |
| MinIO console won't open / uploads fail | Docker Desktop isn't running. Everything in step 1 requires it. |
| Changed `.env` but behavior didn't change | tsx watch and uvicorn `--reload` don't watch `.env`. Restart the process. |

## Alternative: backend in Docker

`docker compose up -d` also builds and runs the **backend** container
(production build, `STORAGE_PROVIDER=minio` preconfigured, same port 3001).
Don't run the host `npm run dev` backend at the same time — they'd fight over
port 3001. The Python service and frontend are not part of the compose file and
always run on the host as described above.
