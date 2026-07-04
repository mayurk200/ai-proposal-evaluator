# Phase 1 — Upload files → MinIO (Docker)

Phase 1 goal: a user uploads **one or more files** from the React frontend, and
every file is stored in a **MinIO (S3-compatible) bucket** running in Docker.
Nothing is extracted or evaluated — a stored file just sits in the bucket until
the user chooses to act on it in a later phase.

## What was added / changed

| File | Purpose |
|------|---------|
| `backend/src/modules/upload/upload.controller.ts` | `uploadMany` stores files in MinIO; `listAll` lists what's stored |
| `backend/src/modules/upload/upload.routes.ts` | `POST /api/uploads` (store) + `GET /api/uploads` (list) |
| `backend/src/providers/storage/minio.provider.ts` | Auto-creates the bucket + public-read policy; keeps the original filename as object metadata; `list()` enumerates objects |
| `backend/src/providers/storage/types.ts` | Adds `StoredObject` + optional `list()` to the provider contract |
| `frontend/src/services/proposal.service.ts` | `uploadApi.upload()` / `uploadApi.list()` call the endpoints above |
| `frontend/src/pages/UploadPage.tsx` | Two tabs — **Upload** (→ MinIO) and **All Files** (list + count) |
| `docker-compose.yml` | Adds `backend` + a `createbuckets` init + MinIO healthcheck |

> Removed in this phase: the throwaway `backend/public/index.html` upload page and
> the static-file wiring in `server.ts` / `Dockerfile` that served it. Uploading now
> lives entirely in the React frontend.

## Frontend flow (React)

The `/upload` page (`frontend/src/pages/UploadPage.tsx`) has two tabs:

- **Upload** — drag-and-drop or browse to pick up to 20 files (PDF, DOCX, PPTX,
  images, …), then **Upload to storage** sends them to `POST /api/uploads`. That is
  all it does: the files land in MinIO. No text extraction, no AI, no evaluation —
  nothing happens to a file until a later phase explicitly acts on it.
- **All Files** — calls `GET /api/uploads` and lists every stored object with its
  original name, size, upload time, and a direct link, plus a live count badge on the
  tab. A **Refresh** button re-fetches on demand.

The upload endpoints are unauthenticated in Phase 1, so the page works without login.

## Run it

From the project root, start the stack (MinIO + backend + postgres):

```bash
docker compose up --build
```

This starts:

- **MinIO** — API on `:9000`, web console on `:9001`
- **createbuckets** — one-shot job that creates the `proposals` bucket and allows public downloads, then exits
- **backend** — API on `:3001` (waits for MinIO to be healthy)
- **postgres** — not used in Phase 1, but part of the stack

Then run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

- Upload UI → <http://localhost:5173/upload> (Upload tab to store, All Files tab to browse)
- MinIO console → <http://localhost:9001> (login `minioadmin` / `minioadmin`)

Pick one or more files on the **Upload** tab, click **Upload to storage**, and the
app switches to **All Files**, where every stored object is listed with its name,
size, upload time, and a direct link. Confirm the same objects appear under the
`proposals` bucket in the MinIO console.

## API (test without the UI)

```bash
# store one file
curl -F "files=@/path/to/proposal.pdf" http://localhost:3001/api/uploads

# store multiple files
curl -F "files=@a.pdf" -F "files=@b.docx" http://localhost:3001/api/uploads

# list what's stored
curl http://localhost:3001/api/uploads
```

`POST /api/uploads` response:

```json
{
  "success": true,
  "storageProvider": "minio",
  "bucket": "proposals",
  "count": 2,
  "files": [
    { "originalName": "a.pdf",  "key": "proposals/<uuid>.pdf",  "size": 12345, "contentType": "application/pdf", "url": "http://localhost:9000/proposals/<uuid>.pdf" },
    { "originalName": "b.docx", "key": "proposals/<uuid>.docx", "size": 23456, "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "url": "http://localhost:9000/proposals/<uuid>.docx" }
  ]
}
```

`GET /api/uploads` response (newest first):

```json
{
  "success": true,
  "storageProvider": "minio",
  "bucket": "proposals",
  "count": 2,
  "files": [
    { "key": "proposals/<uuid>.docx", "name": "b.docx", "size": 23456, "lastModified": "2026-07-04T10:15:00.000Z", "url": "http://localhost:9000/proposals/<uuid>.docx" },
    { "key": "proposals/<uuid>.pdf",  "name": "a.pdf",  "size": 12345, "lastModified": "2026-07-04T10:14:30.000Z", "url": "http://localhost:9000/proposals/<uuid>.pdf" }
  ]
}
```

The listed `name` is the original upload filename (read back from object
metadata); objects stored before that metadata was added fall back to the key.

## Configuration

The backend selects storage via `STORAGE_PROVIDER`. Docker Compose sets it to
`minio` and wires these values for the `backend` service:

| Var | Value (compose) | Notes |
|-----|-----------------|-------|
| `STORAGE_PROVIDER` | `minio` | switch to `local`/`s3`/`cloudinary` to change backend |
| `MINIO_ENDPOINT` | `http://minio:9000` | S3 API endpoint used **inside** the network |
| `MINIO_PUBLIC_ENDPOINT` | `http://localhost:9000` | used to build browser-openable URLs |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `minioadmin` / `minioadmin` | MinIO root creds |
| `S3_BUCKET` | `proposals` | bucket name (auto-created) |
| `MAX_FILE_SIZE` | `52428800` | 50 MB per file |

The frontend talks to the API via `VITE_API_URL` (see `frontend/.env`), which
defaults to `http://localhost:3001/api`.

Allowed file types: PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP
(defined in `backend/src/config/constants.ts`).

## Verified

Smoke-tested against the Docker MinIO (`docker compose up -d minio`):

1. `GET /api/uploads` on an empty bucket → `{ count: 0, files: [] }`.
2. `POST /api/uploads` with a file → `201`; the object is stored under
   `proposals/<uuid>.ext` with its original filename preserved as metadata.
3. `GET /api/uploads` → the file is listed with its **original name**, size, and
   upload timestamp (newest first).
4. The returned `url` opens the object directly (HTTP 200), thanks to the bucket's
   public-read policy.

The `local` provider (which has no native listing) was also confirmed to degrade
gracefully: `GET /api/uploads` returns an empty list with an explanatory `note`
instead of erroring.

## Running the backend on the host (no backend container)

Start just MinIO with Docker, then run the API locally:

```bash
docker compose up -d minio createbuckets
cd backend
# in backend/.env set:
#   STORAGE_PROVIDER=minio
#   MINIO_ENDPOINT=http://localhost:9000
#   MINIO_PUBLIC_ENDPOINT=http://localhost:9000
#   AWS_ACCESS_KEY_ID=minioadmin
#   AWS_SECRET_ACCESS_KEY=minioadmin
#   S3_BUCKET=proposals
npm install
npm run dev
```

Then run the frontend (`cd frontend && npm run dev`) and open
<http://localhost:5173/upload>.

## Notes

- The MinIO provider is self-healing: on first upload it creates the bucket and
  applies a public-read policy, so uploads work even if the `createbuckets`
  init step is skipped.
- Public-read is enabled so the returned URLs open directly in a browser —
  convenient for Phase 1 verification. Tighten this (presigned URLs) before
  production.
- `GET /api/uploads` issues one `HeadObject` per object to recover the original
  filename. That's fine at Phase 1 volumes; back it with a database index if the
  bucket grows large.
