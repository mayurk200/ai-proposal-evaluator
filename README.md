<p align="center">
  <h1 align="center">AgriEval</h1>
  <p align="center">Evidence-based evaluation of agricultural innovation proposals</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/FastAPI-Python_3.11+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Postgres-pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="Postgres + pgvector" />
  <img src="https://img.shields.io/badge/LLM-Groq_LLaMA_3.3_70B-F55036?style=flat-square&logo=meta&logoColor=white" alt="Groq" />
  <img src="https://img.shields.io/badge/Tests-183_passing-brightgreen?style=flat-square" alt="183 tests" />
</p>

---

AgriEval scores agricultural startup proposals against the seven AIAIC parameters, and
**every score it gives cites the words in the document that produced it**.

It is an internal evaluation console, not a public tool. Two operators sign in — an
administrator who decides, and a desk user who processes — and the system is built to
hold a growing archive of ideas for years, tracking not just what each proposal scored
but who was approved, in which category, from which company, and when.

## What makes it different

**Every score is traceable.** A parameter score is the mean of sub-scores, and each
sub-score carries a verbatim quote from the proposal. Those quotes are then *checked
against the source document* — a quote the model invented is discarded, and if that
leaves a sub-question with no evidence, it loses its score. (On real proposals this
catches the model fabricating roughly 18% of its citations: plausible sentences,
reconstructed from tables, that the document never actually contained.)

> **9.0/10** — *Is the scale and severity of the problem evidenced with concrete data?*
> “Claims under traditional schemes take 90–120 days” — *section: problem*

**Silence is not a bad answer.** A parameter the proposal never addresses scores `null`,
not zero, and is excluded from the weighted mean rather than counted against the
applicant. Zero would mean "they answered, and it was terrible" — a different and far
more damaging claim. And a parameter *we* failed to assess (a rate limit, a timeout) is
reported separately again, as our failure, never as theirs.

**Duplicate ideas are caught before they cost anything.** A new submission is compared
against the whole archive on the *substance of the idea* — its problem and its solution,
not its wording — so a reworded resubmission under a different company name is still
caught. The admin sees both side by side and decides whether to evaluate. Ingestion costs
one cheap LLM call; an evaluation costs ~35,000 tokens.

**Approvals are balanced, and the system enforces it.** Approving a second idea into a
category that already has one, or a company that has already won elsewhere, is **refused**
— with the specific conflict shown. An evaluator can override deliberately, and the
override is recorded against their name.

**The final score is blind.** The synthesising agent never sees the company name, never
sees the raw document, and does not do the arithmetic. It reasons over the specialists'
findings and their quotes; the weighted score is computed in Python before it is called,
and the model may nudge it by at most ±8 points with a stated reason.

## Quick start

```bash
cp .env.example .env      # set GROQ_API_KEY — the only value you must supply
./run.sh                  # Linux / macOS
```
```powershell
copy .env.example .env    # set GROQ_API_KEY
.\run.ps1                 # Windows
```

That is the whole setup. The script checks your prerequisites, starts Postgres, creates
the Python virtualenv, installs both npm trees, pre-warms the tokenizer and the embedding
model, starts all three services in dependency order, seeds the two operator accounts,
health-checks each one, and tells you where to go. Ctrl+C stops everything.

Open **http://localhost:5173** and sign in.

| | |
|---|---|
| `./run.sh` | start everything (installs whatever is missing) |
| `./run.sh --stop` | stop the services *and* the containers |
| `./run.sh --clean` | stop, and **destroy** the database and stored files |
| `./run.sh --setup` | install and prepare, but do not start |
| `./run.sh --no-docker` | use a Postgres you are running yourself |

Windows takes the same flags as `-Stop`, `-Clean`, `-Setup`, `-NoDocker`.

Cold start is a few minutes (pip, and a 130MB embedding model). **Warm start is ~10
seconds** — dependencies are reinstalled only when `requirements.txt` or `package.json`
actually change, and the seed is idempotent.

### Prerequisites

| | | |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| Python | ≥ 3.11 | `python3 --version` |
| Docker | any recent | `docker info` |
| Tesseract | optional | `tesseract --version` — without it, scanned PDFs and images are not OCR'd |
| Groq API key | — | [console.groq.com/keys](https://console.groq.com/keys) |

```bash
sudo apt install tesseract-ocr        # Debian/Ubuntu
brew install tesseract                # macOS
```
Windows: [UB-Mannheim installer](https://github.com/UB-Mannheim/tesseract/wiki), then set
`TESSERACT_CMD` in `.env` if it is not on PATH.

### Configuration

`.env` at the repo root is **the only file you edit**. `backend/.env` and
`python-service/.env` are generated from it on every run — do not edit those.

## How it works

```
upload ──> store original ──> extract ──> sectionise ──> metadata (1 cheap LLM call)
                                                              │
                                                    embed + similarity search
                                                              │
                                             ┌────────────────┴────────────────┐
                                     looks like an existing idea         nothing similar
                                             │                                 │
                                     ADMIN sees both,                       queued
                                     decides: evaluate / skip                  │
                                             └────────────────┬────────────────┘
                                                              ▼
                              7 parameter agents (PARALLEL, section-routed, cited)
                                                              │
                                              debate (only on real contradictions)
                                                              │
                                        blind synthesis ──> score + SWOT + recommendation
                                                              │
                                              ADMIN approves / rejects / funds
                                                    (guardrails apply)
```

**Extraction** reads PDFs in true reading order and detects headings from *font size*, not
an ALL-CAPS regex. Tables come out via pdfplumber; scanned pages are deskewed, denoised and
binarized before OCR, and OCR'd in parallel.

**Sectioning** cuts the document on its real headings and labels each block — `problem`,
`solution`, `financial`, `team`, `compliance`, … Each agent then receives only the sections
it is meant to judge. Contact details go to an `identity` bucket that no scoring agent ever
sees: an applicant's email address is not evidence about their pilot design.

**Metadata** is generated for every idea, whether or not it is ever evaluated — so an idea
ingested today can be evaluated a year from now straight from the database, with no
re-upload and no re-extraction.

### The seven parameters

| Parameter | Weight | Reads |
|---|---|---|
| Problem & Relevance | 15% | problem, vision, adoption |
| Solution & Technology Readiness | 20% | solution, pilot, compliance |
| Pilot Design & Feasibility | 20% | pilot, financial, adoption |
| Farmer Adoption & Inclusion | 15% | adoption, business model, problem |
| Business Model & Scale-up | 15% | business model, financial, solution |
| Team & Capacity | 10% | team, identity |
| Compliance & Governance | 5% | compliance, solution |

Plus a **metadata agent** (runs once at ingest, on the small model), a **debate agent**
(runs only when the parameter scores actually contradict each other), and the **blind
synthesis agent**.

## Architecture

```
React ──> Node gateway ──> Python AI service ──> Postgres (+ pgvector)
          auth, upload,      extraction, OCR,      MinIO / local storage
          proxy              agents, decisions     Groq
```

The Node tier is a **pure gateway**: JWT auth, upload forwarding, and a proxy that stamps
the caller's identity onto every request so Python can attribute a decision. It holds no
LLM credentials and runs no AI. **When the AI service is down, you get a 503 that says so**
— there is no fallback pipeline quietly scoring against a different rubric.

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, TailwindCSS v4, TanStack Query, Zustand, Recharts |
| Gateway | Node.js, Express, TypeScript |
| AI service | Python 3.11+, FastAPI, Pydantic |
| Database | PostgreSQL 16 + **pgvector** (HNSW index for similarity) |
| Storage | MinIO / S3 / local filesystem |
| LLM | Groq — LLaMA 3.3 70B (judgment), LLaMA 3.1 8B (metadata) |
| Embeddings | fastembed / BAAI bge-small — local, CPU, no API cost |
| OCR | Tesseract → EasyOCR fallback, with OpenCV preprocessing |
| Documents | PyMuPDF, pdfplumber, python-docx, python-pptx |
| Auth | JWT + bcrypt, two roles |

### Roles

| | |
|---|---|
| **ADMIN** | Decides: resolves the duplicate gate, approves/rejects, marks funding, manages users |
| **DESK2** | Uploads, processes, retries, reads everything — but cannot decide |

There is no public sign-up. Accounts are seeded, and only an admin can create more.

### The database

Eight tables. Two carry most of the weight:

- **`companies`** — interned on a *normalized* name, so `Acme Agri Pvt. Ltd.`, `ACME AGRI`
  and `Acme Agri Private Limited` are **one** company. Without this, the same firm submits
  under three spellings and wins three slots.
- **`decisions`** — an append-only ledger. The category and company are *frozen onto the
  row at decision time*: if an idea is recategorised next year, last March's approval must
  not silently move to a different category.

Plus `users`, `proposals` (with a `vector(384)` column), `categories` (**minted on first
sight — not predefined**), `evaluations`, `similarity_matches`, and `audit_log`.

## Rate limits — read this

Groq meters `input + max_tokens` against a **rolling per-minute budget**, and this is the
single biggest lever on how fast the system runs.

| model | free-tier TPM | free-tier daily |
|---|---|---|
| `llama-3.3-70b-versatile` (agents) | 12,000 | ~100,000 |
| `llama-3.1-8b-instant` (metadata) | 6,000 | — |

An evaluation costs **~35,000 tokens** and, on the free tier, takes **about 4 minutes** —
almost all of it *waiting on the token budget*, not on inference. That also means roughly
**three evaluations per day** before the daily cap stops you.

A TPM-aware rate limiter handles the pacing (rolling window, reserve-then-reconcile,
oversized requests rejected up front rather than retried into a wall), so you will not see
413s or 429 storms. But it cannot conjure budget that is not there.

> **Raise your Groq tier and raise `LLM_TPM` / `LLM_TPM_FAST` in `.env`.** No code changes.
> It is the highest-leverage change available.

## Supported formats

| Format | Extension | Processing |
|---|---|---|
| PDF | `.pdf` | Layout-aware extraction, font-size heading detection, pdfplumber tables, OCR for scanned pages |
| Word | `.docx`, `.doc` | python-docx, using Word's own heading styles |
| PowerPoint | `.pptx`, `.ppt` | python-pptx, slide titles as headings |
| Text | `.txt` | Direct |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` | Full OCR, with deskew/denoise/binarize |

Up to 50 MB per file, 25 files per batch upload.

## API

All application routes sit behind the gateway at `/api`, authenticated with a Bearer token.

| Method | Endpoint | |
|---|---|---|
| `POST` | `/api/auth/login` | The only unauthenticated route |
| `POST` | `/api/proposals/upload` | Upload 1–25 documents |
| `GET` | `/api/proposals` | List, filter (`status`, `is_evaluated`, `category_id`, …) |
| `GET` | `/api/proposals/:id` | Detail, with evidence, similar ideas and company track record |
| `GET` | `/api/proposals/:id/file` | Stream the original document |
| `POST` | `/api/proposals/:id/evaluate` | Run the agent pipeline |
| `POST` | `/api/proposals/:id/retry` | Retry a failed proposal |
| `GET` | `/api/proposals/:id/similar` | The duplicate gate's matches |
| `POST` | `/api/proposals/:id/review` | Resolve the gate — **ADMIN** |
| `GET` | `/api/proposals/:id/conflicts` | What approving this would collide with |
| `POST` | `/api/proposals/:id/decision` | Approve / reject — **ADMIN** |
| `POST` | `/api/proposals/:id/funding` | Mark selected for funding — **ADMIN** |
| `GET` | `/api/evaluations/:id/export` | PDF report, with the cited evidence |
| `GET` | `/api/analytics/overview` | Everything the dashboard needs |
| `GET` | `/api/analytics/{categories,companies,timeline}` | Approvals by category, company, month |
| `POST` | `/api/batches/:id/evaluate` | Evaluate a batch |
| `GET` | `/api/health` | Public |

Interactive docs for the AI service: **http://localhost:8000/docs**

## Tests

```bash
cd python-service && ./venv/bin/python -m pytest tests/ -q     # 157
cd backend        && npm test                                  # 26
```

The Python suite pins the invariants that matter: fabricated quotes are dropped; a score
without a citation is downgraded; unanswered is `null` and never `0`; a failed agent is
never reported as an applicant's gap; the blind prompt contains no identity; the ±8
adjustment band is clamped; the company-name collapsing works; the rate limiter rejects a
request that cannot fit.

## Documentation

| | |
|---|---|
| **[REPORT.md](REPORT.md)** | **The rebuild in full** — what changed, why, every bug found, all the optimisations, and what I would do next |
| [docs/](docs/) | Older design notes. Predate the rebuild; treat REPORT.md as authoritative. |

## Project structure

```
ai-proposal-evaluator/
├── run.sh / run.ps1       one-command startup (Linux/macOS, Windows)
├── .env.example           the only file you edit
├── docker-compose.yml     Postgres (pgvector) + MinIO
├── frontend/              React 19 + Vite + Tailwind
├── backend/               Node gateway — auth, upload, proxy
└── python-service/
    ├── app/agents/        7 parameter agents + metadata, debate, blind scoring
    ├── app/services/
    │   ├── extraction/    layout-aware text, pdfplumber tables, form fields
    │   ├── ocr/           Tesseract → EasyOCR, with OpenCV preprocessing
    │   ├── processing/    sectioniser, ingestion, evaluation, decisions, batch
    │   ├── embeddings/    local embeddings for the duplicate gate
    │   ├── database/      proposals, evaluations, registry (companies/categories/decisions)
    │   └── reporting/     PDF export
    └── tests/
```

## Known limits

- **`/evaluate` is synchronous** and holds a connection for ~4 minutes on the free tier.
  The evaluation row opens *before* the agents run, so a crash is recoverable — but it
  wants a background task and a poll.
- **Schema is created with `create_all`**, not migrations. Fine now; add Alembic before
  altering a table that holds real funding decisions.
- **`BackgroundTasks`, not a job queue.** A process restart mid-ingest leaves a retryable
  row, but nothing picks it up automatically.
- **`run.ps1` is unverified on Windows** — written and reviewed carefully, but not executed
  on a Windows machine.
