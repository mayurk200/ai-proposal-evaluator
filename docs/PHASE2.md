# Phase 2 — Process Files (Extract + Categorize)

Select uploaded files and **send them for processing**. Processing = extract the
document's text → store it → run a **categorization agent** that reads the text and
produces a **rich JSON** (title, summary, problem/solution, technologies,
beneficiaries, geography, stage, **agri-only categories**, keywords, a triage
**rank**, and status **flags**) → store that JSON. Processed files then appear on the
**Proposals** page (with a **category filter**) and drop off the **All Files** tab,
while the original stays in MinIO.

> **No scoring/evaluation happens in this phase.** Categorization is triage only.
> Evaluation is a later phase.

---

## Flow

```mermaid
graph LR
    A[All Files tab] -->|select + Send| B[POST /api/uploads/process]
    B --> C[Node downloads object from MinIO]
    C --> D[POST /api/v1/categorize]
    D --> E[(row: categorizing)]
    D -.background.-> F[extract text]
    F --> G[store extracted text]
    G --> H[CategorizationAgent → rich JSON]
    H --> I[(row: categorized)]
    I --> J[Proposals page]
```

1. On **All Files**, the user checks one or more files and clicks **Send for processing (N)**.
2. Node (`/api/uploads/process`) downloads each object from MinIO and forwards it to the
   Python service (`/api/v1/categorize`), passing the MinIO `source_key` + `source_url`.
3. Python creates a `proposals` row with status `categorizing` and returns immediately.
   Extraction + categorization run in a **FastAPI background task**.
4. When done the row moves to `categorized` (or `failed`), now carrying `categories`,
   `rank`, `agri_relevant`, and the full categorization JSON.
5. The file disappears from **All Files** (its `source_key` is now known) and appears on
   **Proposals**, which polls until processing finishes.

---

## Architecture notes

- Frontend talks to **Node** (`:3001`) only. Node proxies AI work to the **Python
  service** (`:8000`) via `backend/src/utils/pythonProxy.ts`.
- Node's own store is Firestore/local-JSON; the **Python service owns Postgres** (the
  `proposals` table). All categorization data lives in Postgres.
- Correlation handle: the MinIO object key is stored on the Python row as `source_key`.
  The original file is **not** re-uploaded to Python storage — `source_key`/`source_url`
  reference the existing MinIO object.
- **Hard dependency:** categorization exists only in Python (no Node fallback like
  evaluate has), so Phase 2 requires the Python service running — surfaced as a **503**.

---

## Categories (agri-only)

The agent assigns **agriculture-related categories only**. It may assign **multiple** per
file and may **invent new** agri categories (as kebab-case slugs), but **never** non-agri
ones. A curated seed taxonomy lives in `app/config.py` (`AGRI_CATEGORY_TAXONOMY`).

A non-agri document comes back with `agri_relevant = false`, `categories = []`, and
`flags.out_of_scope = true`.

---

## Categorization JSON (rich schema)

Produced by `CategorizationAgent` and stored on the row (`category_json`):

| Field | Type | Notes |
|---|---|---|
| `title` | string | Inferred document title |
| `summary` | string | Short abstract |
| `problem_statement` | string | |
| `proposed_solution` | string | |
| `technologies` | string[] | |
| `target_beneficiaries` | string[] | |
| `geography` | string | |
| `stage` | string | e.g. idea / pilot / scaling |
| `categories` | string[] | Agri-only kebab-case slugs (≤ 8) |
| `keywords` | string[] | |
| `agri_relevance` | number | 0–1 |
| `rank` | int | 0–100 **triage** score (not an evaluation) |
| `confidence` | number | 0–1 |
| `flags` | object | `agri_relevant`, `needs_review`, `insufficient_text`, `out_of_scope` |

---

## API

### Node (frontend-facing)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/uploads/process` | Body `{ files: { key, name }[] }` → send stored files for processing. `503` if Python is down. |
| `GET` | `/api/uploads/processed` | List categorized proposals. Query: `category`, `status`, `page`, `limit`. |
| `GET` | `/api/uploads/categories` | Distinct agri categories with counts (for the filter). |
| `GET` | `/api/uploads` | Existing list — now **excludes** files already sent for processing. |

### Python (internal)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/categorize` | Multipart `file` + `source_key` + `source_url`. Creates row `categorizing`, runs async. Deduplicates by `source_key` then file hash. |
| `GET` | `/api/v1/proposals` | Summary list; filters `category`, `status`. |
| `GET` | `/api/v1/categories` | `[{ category, count }]`. |
| `GET` | `/api/v1/processed-source-keys` | `source_key`s that already have a row (processing or done). |

---

## Data model (new `proposals` columns)

`source_key`, `source_url`, `categories` (JSON array text), `category_json` (full JSON
text), `rank` (int, indexed), `agri_relevant` (bool), `categorized_at` (datetime).

These are added idempotently at startup — `app/main.py` calls
`get_proposal_repository().init_tables()`, which runs `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` (`create_all` alone only creates missing tables, not new columns on an existing one).

---

## Files touched

**Python (`python-service`)**
- `app/models/enums.py` — `ProcessingStatus.CATEGORIZED`.
- `app/config.py` — `AGRI_CATEGORY_TAXONOMY`.
- `app/models/schemas.py` — `CategorizationFlags`, `CategorizationResult`, `CategorizeResponse`.
- `app/services/database/models.py` — new `ProposalRecord` columns.
- `app/services/database/proposal_repository.py` — column handling, filters, `get_by_source_key`, `list_source_keys`, `list_categories`, startup ALTERs.
- `app/agents/categorization/` — `CategorizationAgent` (agri-only prompt, slug normalization, flag/rank coercion).
- `app/services/processing/categorization_service.py` — `run_categorization` background worker.
- `app/api/routes.py` — `/categorize`, `/categories`, `/processed-source-keys`, filtered `/proposals`.
- `app/main.py` — startup migration for the new columns.

**Node (`backend`)**
- `src/utils/pythonProxy.ts` — `categorizeWithPythonService`, `listProcessedProposals`, `listProcessedCategories`, `listProcessedSourceKeys`.
- `src/modules/upload/upload.controller.ts` — `process`, `listProcessed`, `listCategories`; `listAll` excludes processed keys.
- `src/modules/upload/upload.routes.ts` — new routes.

**Frontend (`frontend`)**
- `src/services/proposal.service.ts` — `uploadApi.sendForProcessing / listProcessed / listCategories` + types.
- `src/pages/UploadPage.tsx` — All Files multiselect + "Send for processing".
- `src/pages/ProposalsPage.tsx` — processed list, category filter, status/rank badges, category chips, expandable detail, live polling.

---

## Running & verifying

**1. Python service** (currently the missing piece — install deps first):

```bash
cd python-service
venv/Scripts/python.exe -m pip install -r requirements.txt
# env:
#   GROQ_API_KEY=<key>
#   DATABASE_URL=postgresql+asyncpg://agrieval:agrieval123@localhost:5432/agrieval
venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Confirm `GET /api/v1/health` is OK and startup logs `database_ready` (proves the Phase 2
migration ran). `STORAGE_PROVIDER=local` is fine here — the original stays in MinIO,
referenced by `source_key`.

**2. Node** (`:3001`, `STORAGE_PROVIDER=minio`) and **Frontend** (`:5173`).

**3. End-to-end:**
- Upload a proposal on `/upload` → it appears on **All Files**.
- Select it → **Send for processing** → it disappears from All Files.
- On `/proposals` it shows `categorizing` → `categorized` with `categories`, `rank`, summary.
- The **category filter** narrows the list.
- A non-agri doc returns `agri_relevant = false`, `categories = []`, `flags.out_of_scope = true`.
- Confirm the MinIO object still exists and **no evaluation/scoring** ran.

---

## Risks / notes

- Python must be up for processing (no Node fallback) — surfaced as a `503`.
- Category filter uses a JSON-text `LIKE` (fine at this scale; revisit if volume grows).
- Processing is **idempotent** — the same `source_key` (or identical file hash) returns the
  existing row instead of reprocessing.
- The old Firestore-backed `ProposalDetailPage` is intentionally **not** linked from
  categorized cards this phase (different datastore); detail is shown inline instead.
