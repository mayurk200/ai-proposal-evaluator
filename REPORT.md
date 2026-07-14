# AgriEval — Rebuild Report

What changed, why, and what it cost. Written for the person who has to maintain this
next, and for the client who asked for it.

**Scope of the change:** 147 files, +13,258 / −16,215 lines. 70 files deleted, 32 added.
The system is meaningfully *smaller* than it was, and does considerably more.

**Verification:** 157 Python tests pass; the Node gateway and the React frontend both
typecheck clean; every claim below was exercised end-to-end against a live Postgres, a
live Groq key, and the two real AIAIC proposals in `documents/`.

---

## Contents

1. [The starting point](#1-the-starting-point)
2. [What the client asked for, and where it landed](#2-what-the-client-asked-for-and-where-it-landed)
3. [Architecture](#3-architecture)
4. [The evaluation pipeline](#4-the-evaluation-pipeline)
5. [Bugs found and fixed](#5-bugs-found-and-fixed)
6. [Optimisations](#6-optimisations)
7. [The constraint that governs everything: Groq rate limits](#7-the-constraint-that-governs-everything-groq-rate-limits)
8. [Testing](#8-testing)
9. [Running it](#9-running-it)
10. [What I would do next](#10-what-i-would-do-next)

---

## 1. The starting point

Before anything else: **the `architecture.md` in the repo did not describe this
codebase.** It documented a `preflight.py`, a `chunk_router.py`, a `status_tracker.py`,
an ingestion service, a proposal repository, and `/categorize` + `/ingest` + `/proposals`
endpoints. None of those existed. I ignored it and read the code.

What was actually there:

| | |
|---|---|
| **Two AI pipelines** | Python had the real one (7 AIAIC agents). Node had a *second, different* one (Agriculture / Financial / Sustainability / Risk / Innovation) that silently took over whenever Python was unreachable. |
| **Two databases** | Node wrote to Firestore — or, with no credentials present, silently to JSON files under `backend/data/`. Python wrote to Postgres. Neither knew about the other. |
| **No proposal registry** | Only an `evaluations` table. No companies, no categories, no decisions, no timeline, no audit. |
| **No auth in practice** | `optionalAuthMiddleware` waved through tokenless requests and treated them as an anonymous owner. Every page and every API route was reachable logged-out. `express.static('/uploads')` published every uploaded proposal to anyone who could guess a filename. |
| **Scores you could not defend** | An agent produced a number and a paragraph of prose. Nothing tied either to the document. |

The Node fallback deserves special mention, because it is the thing the client noticed.
It did not merely produce a *worse* answer when Python was down — it produced an answer
from **a completely different rubric**, then `mapPythonResponseToLegacy` flattened
Python's seven real AIAIC parameters onto the old field names so the frontend could keep
reading them. The resulting numbers looked authoritative and were not comparable to
anything else in the database.

It is gone. When the AI service is down, you get a 503 that says so.

---

## 2. What the client asked for, and where it landed

| # | Requirement | Where it lives |
|---|---|---|
| **a** | Consider previous startup ideas | `proposals` table + pgvector similarity search. Every idea ever ingested stays queryable, evaluated or not. |
| **b** | Cite the basis for every score | `Citation` on every sub-question, **verified against the source document**. §4.3 |
| **c** | SWOT should be continuous | `SWOTAnalysis.narrative` — one argument, not four stubs. |
| **d** | Track approvals per category; avoid concentrating them | `decisions` ledger + **approval is refused** when the category already holds one. §4.5 |
| **e** | Track approvals per company across domains; prevent one company taking every slot | Company interning + **approval is refused** when the company has already won. §4.5 |
| **f** | Show all of it on a timeline (year/month) | `decision_year` / `decision_month`, denormalized and indexed. |
| **g** | Store documents safely; export to PDF; manage and **retry** failures | Original stored before anything can fail; PDF export carries the evidence; failures are a queue, not silence. |
| **h** | Detect similar ideas, show the admin both, let them decide; then route sections to agents; unbiased final synthesis | The duplicate gate (§4.2) and section routing (§4.1) + blind synthesis (§4.4). |
| — | Metadata for every idea, evaluated or not | `idea_metadata` + `is_evaluated` flag. Generated on ingest, always. |
| — | Evaluate a stored idea later without re-uploading | Sections persisted at ingest; evaluation reads from the DB. |
| — | Mark an idea selected for funding | `selected_for_funding` decision. |
| — | Batch upload / processing | Same ingest endpoint; batch evaluation paced by the token budget. |
| — | Users, auth, roles (admin + desk2) | Postgres `users`, JWT, RBAC. §3.3 |
| — | Richer dashboard, icons not emojis | Rebuilt. lucide icons throughout. |
| — | View the original file of an approved idea | Authenticated stream, opens in a new tab. |
| — | Built to run for years | Append-only ledger, audit log, HNSW index, real migrations path. |

---

## 3. Architecture

### 3.1 Before → after

```
BEFORE                                   AFTER

React ──> Node ──> Firestore             React ──> Node ──> Postgres (users only)
           │       or JSON files                    │
           ├──> Node AI agents  ◄── fallback        └──> Python ──> Postgres (everything)
           └──> Python AI agents                             ├──> MinIO / local storage
                    └──> Postgres                            └──> Groq
```

Node is now a **pure gateway**: JWT auth, upload forwarding, and a proxy that stamps the
caller's identity onto every request so Python can attribute a decision without
re-implementing JWT in a second language.

Node also no longer touches object storage. It used to write its own copy to MinIO, and
Python then wrote a second (and `/ingest` a third) — three copies of every file and no
agreement on which was authoritative. Bytes now go straight through; Python stores the
one canonical original.

**Deleted from Node:** `modules/ai/` (orchestrator, 7 agents, prompts), four LLM
providers (groq/openai/gemini/ollama), `utils/textExtractor.ts`, `config/database.ts`
(Firestore), `config/localStore.ts` (the JSON-file store), all storage providers, and
`mapPythonResponseToLegacy`. Nine npm dependencies went with them: `firebase-admin`,
`groq-sdk`, `openai`, `@google/generative-ai`, `cloudinary`, `@aws-sdk/client-s3`,
`mammoth`, `pdf-parse`, `uuid`.

### 3.2 The schema

Eight tables in one Postgres. The two that carry the client's requirements:

**`companies`** — interned on a *normalized* name. This is not cosmetic; it is the whole
of requirement (e):

```
'Acme Agri Pvt. Ltd.'       ─┐
'ACME AGRI'                  ├──>  one company id
'Acme Agri Private Limited'  ─┘
```

Without it, the same firm submits under three spellings and wins three slots.

**`decisions`** — an **append-only** ledger. `category_id` and `company_id` are *frozen
onto the row at decision time*, not read through the proposal at query time. If an idea
is recategorised next year, last March's approval counts must not silently move to a
different category. `decision_year` / `decision_month` are denormalized so the timeline
is an indexed `GROUP BY` rather than a date-parse over the whole table.

Also: `users`, `categories` (minted on first sight — the client was explicit that
categories are **not** predefined), `proposals` (with a `vector(384)` column and an HNSW
index), `evaluations`, `similarity_matches`, `audit_log`.

### 3.3 Auth

Two seeded accounts, `admin` and `desk2`.

- **ADMIN** decides: resolves the duplicate gate, approves/rejects, marks funding, manages users.
- **DESK2** uploads, processes, retries, and reads everything — but cannot decide.

Self-registration is **gone**. Anyone who could register could read every proposal and
see every funding decision. `optionalAuthMiddleware` is gone with it.

Verified through the real gateway: tokenless request → 401; wrong password → 401; DESK2
approving → **403**; DESK2 listing users → **403**; ADMIN reaches the decision route.

---

## 4. The evaluation pipeline

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
```

Ingestion makes **exactly one** LLM call. Extraction, sectioning, embedding and
similarity search are all local and cost nothing — which is what makes it affordable to
catch a duplicate *before* paying for an evaluation.

### 4.1 Extraction and sectioning

**Extraction was rewritten.** The old code called `page.get_text("text")`, which returns
characters in PDF storage order. On the two-column layouts and boxed forms that AIAIC
proposals actually use, that interleaves the columns — agents were scoring documents
whose sentences did not join up. Text now comes out in true reading order, and **headings
are detected from font size**, not an ALL-CAPS regex. On your real proposals this finds
123 headings, which turn out to be exactly the form's field labels.

Tables moved from PyMuPDF's weak finder to **pdfplumber** (7 tables/doc on your files —
these are the budget and workplan, i.e. the numbers the finance agent is scored against).
OCR gained **deskew + denoise + binarize** preprocessing, and now uses Tesseract's actual
*confidence* to decide on fallback — the old check was "did it return any characters",
which happily accepted a page of confident garbage. Scanned PDFs OCR their pages in
parallel instead of re-parsing the whole PDF once per page.

**Chunking is gone.** The old chunker cut documents into 2,000-token windows and left
every agent to keyword-scan all of them. Documents are now cut on their real headings and
each block is labelled by a two-tier classifier: keyword-on-heading first (free), semantic
embedding only for the ambiguous remainder. It resolves cleanly —

```
"Solution Synopsis"                 -> solution
"Founders Background"               -> team
"Unit economics"                    -> financial
"Strategic impact on Maharashtra"   -> vision
"Contact / Email / Startup Name"    -> identity   [never sent to a scoring agent]
```

An applicant's email address is not evidence for or against their pilot design, so
identity fields are captured for metadata and excluded from agent dispatch. **91%** of a
real proposal reaches the agents; the rest is contact detail.

### 4.2 The duplicate gate (h)

Similarity is computed on the **substance of the idea** — its title, theme, problem and
solution — not on the whole document. Proposals from one accelerator share boilerplate,
headers and compliance language; embedding the full text would flag them as similar
because their *paperwork* matches, and the admin would quickly learn to click through the
warning without reading it. That is worse than not having the gate.

The company name is deliberately **excluded** from the embedding: the same company
submitting a genuinely different idea must not look like a duplicate, and two different
companies converging on the same idea very much must.

**I calibrated the threshold against real data, and it caught a bug in my own design.** I
had guessed 0.82. Measuring actual embeddings:

| pair | cosine |
|---|---|
| same idea, fully reworded, different company | **0.814** |
| genuinely different ideas | 0.52 – 0.65 |

0.82 sat *just above* the true positive and would have silently missed every paraphrased
duplicate — the exact thing the gate exists to catch. Moved to **0.72**, in the middle of
the gap. Biased low on purpose: a false positive costs one admin a glance; a false
negative funds the same idea twice.

Verified end-to-end: two different ideas → not flagged. Same idea reworded under a
different company → **flagged at 81.4%**, held for review, with the reason spelled out
("Different company proposing a very similar idea" — which calls for a different decision
than "same company resubmitting"). Byte-identical re-upload → short-circuits on hash, no
reprocessing, no LLM call. Admin chooses *skip* → metadata **kept**, `is_evaluated=false`,
still searchable, still evaluable later.

### 4.3 Evidence (b) — and the model was fabricating quotes

Every sub-score must carry a **verbatim quote** from the document, or be declared
unevidenced. And every quote is then **checked against the source text**. Quotes that
cannot be found are dropped, and if that leaves a sub-question with no citations, it
loses its score.

This is not defensive over-engineering. On a real run it caught the model inventing
roughly **18% of its citations**:

```
citation_not_grounded  TeamCapacityAgent  'Syed Tarique Alam, CEO, MBA'
citation_not_grounded  ScaleUpAgent       'Revenue Model: Subscription fees, Commission…'
citation_not_grounded  PilotDesignAgent   'Key outputs include: 1. Farm-Level Risk Scores…'
```

These are *plausible* — reconstructed summaries of a table, not verbatim text. They were
dropped, and the scores they propped up fell with them: Team Capacity went 85 → 80
(evidence coverage 50% → 25%), and the overall score moved 78.1 → **75.5**. That is the
difference between a score you can defend and one that merely looks defensible.

Matching tolerates punctuation and whitespace normalisation (a model that straightens a
curly quote has not invented anything) but nothing more.

**`null` is not zero.** A parameter the proposal never addresses scores `None`, not 0.
Zero means "they answered, and it was terrible" — a different and far more damaging claim.
Unscored parameters are *excluded from the weighted mean and the weights renormalized*,
because counting a missing DPDP section as 0 would cost the applicant 5 points outright
and turn the overall score into a measure of how completely the form was filled in.

### 4.4 Blind synthesis — the "unbiased result"

The client asked what could be done to get the most unbiased final result. The answer is
mostly about what the final agent is **not allowed to see**:

1. **Never the company.** No name, no founders, no filename. A model that recognises a
   well-known agritech brand carries opinions about it from its training data, and those
   opinions would leak into a government funding decision.
2. **Never the raw document.** If it could re-read the proposal it would re-judge it,
   silently overriding the specialists with a shallower whole-document impression, and the
   evidence discipline would be lost. It reasons over their *findings*.
3. **The arithmetic is not its job.** The weighted score is computed deterministically in
   Python *before* the call. An LLM asked to compute a weighted average produces a
   plausible number, not a correct one, and it drifts between runs. The model may adjust
   the score by at most **±8 points**, with a stated reason; anything wider is clamped, so
   the weights still govern.

Verified: the company's distinctive tokens (`dvara`, `registry`) appear nowhere in the
final agent's 15,250-character prompt, nor does the filename.

**Debate is honest now.** The old `should_trigger()` computed score variance, checked
borderline bands, looked for conflict patterns — and then ended with an unconditional
`return True`. Every check above it was dead code; debate ran on every single proposal,
one large LLM call each time. It now fires only on real contradictions (a >30-point
spread, a red flag under a high score, or a known conflicting pair like *strong revenue
model + farmers who cannot afford it*) and skips otherwise.

### 4.5 Decisions — guardrails, not dashboards

Re-reading requirements (d) and (e), the client wants these things **prevented**: "we
should *avoid* approving ideas in same category", "we can *prevent* single company in each
section". A dashboard the evaluator may not have open prevents nothing.

So the check happens **at the moment of decision**:

| scenario | result |
|---|---|
| First approval in a category | clean |
| **Second idea, same category** | **refused (409)** — "1 idea(s) in Precision Irrigation have already been approved" |
| **Same company, different category** | **refused (409)** — lists exactly what they already hold, with dates |
| Evaluator overrides deliberately | allowed; the override is written to the audit log with their name |
| Approving an idea never evaluated | refused |
| *Rejecting* an idea never evaluated | allowed — an evaluator may reject on sight, and forcing a paid pipeline first would be perverse |

It **refuses**, it does not forbid. There are legitimate reasons to fund two ideas in one
category, and a rule that cannot be overridden gets worked around instead of followed. The
409 carries the full conflict detail so the UI can show what is about to be overridden —
not a bare "are you sure?".

---

## 5. Bugs found and fixed

Beyond the architectural work, these were real defects — several of them found by the
tests and verification runs, not by reading.

### The model was blaming the applicant for our outage

The worst one, found on a live run through the full stack. Two agents failed with a Groq
429, scored `None`, and were reported to the evaluator as **`unevidenced_parameters`** —
that is, *"the proposal did not address this."* It did. **Our** agent broke.

`parameter_score is None` had two completely different causes, and the code conflated
them. An applicant would have lost two parameters — and possibly a funding decision —
because we hit a rate limit.

Now there are three distinct states, carried all the way through the API, the UI and the
PDF:

- **scored** — we assessed it.
- **unevidenced** — the proposal is silent. A finding about the *applicant*.
- **failed** — our agent broke. A fact about *us*. The evaluation is marked **partial**,
  the UI says *"This assessment is incomplete — do not rely on the score yet… the
  applicant has not been penalised for it"*, and offers a re-run.

The blind synthesis prompt is now explicitly told: *"This is NOT a gap in the proposal. Do
not penalise the applicant for it."*

### The rest

| Bug | Consequence |
|---|---|
| **`RETRYABLE_ERRORS = (Exception,)`** | A bad API key, a 400, a context overflow — all retried 5× with up to 60s backoff. Minutes wasted per agent on failures that could never succeed. Now retries only 429/5xx/network/timeout. |
| **Sync Groq client called from `async` agents** | Every LLM call froze the entire event loop. Health checks stalled, polling stalled, "concurrent" background tasks serialised behind whichever one was talking to Groq. Now `AsyncGroq`. |
| **`find_by_hash` touched a lazy relationship** | `MissingGreenlet` under async SQLAlchemy — **every duplicate re-upload would have 500'd.** Found the first time I tested a re-upload. Fixed, and `_to_dict` made structurally safe against the whole class of error. |
| **`"Revenue Model"` routed to the *technology* agent** | The bare word `"model"` sat in the solution agent's keyword list and tied with `"revenue"`; the tie broke on dict order. `"Founders Background"` routed to *problem* for the same reason. Both are headings that appear in real proposals. Found by my own tests. Fixed, plus specificity weighting so multi-word keywords structurally outvote generic collisions. |
| **Substring keyword matching** | `"ip" in text` matched inside "DIPP", "equipment" and "recipient". Agents were fed text with nothing to do with them. Now word-boundary regex. |
| **`/api/health` returned 401** | I mounted the gateway router (which applies `authMiddleware` to everything under `/api`) *before* the health route. Express matches in order, so the one endpoint that must answer without a token was demanding one. Found by driving the real stack. |
| **PDF parameter order was nondeterministic** | Agents complete concurrently, so dict order was *completion* order — the same proposal exported twice had its table rows in different positions. A funding record must not shuffle itself. |
| **`estimate_token_count = len(text) // 4`** | Drove chunk sizing, summary batching and the TPM budget. Under-counted dense financial tables (blowing the rate limit) and over-counted prose (paying for more calls than needed). Now `tiktoken`. |
| **Storage keys interpolated raw filenames** | Unicode, slashes and control characters from a user-supplied name flowed straight into object keys and `Content-Disposition` headers. Now sanitised; the proposal id is the identifier. |
| **`express.static('/uploads')`** | Published every uploaded proposal to anyone who could guess a filename. Removed; originals stream through an authenticated route. |
| **`camelot-py` in requirements** | Declared, never imported. Removed. |

---

## 6. Optimisations

### Token cost — the dominant expense

| Change | Effect |
|---|---|
| **Section routing** replaces whole-document keyword scanning | Each agent sees only its sections. 91% of the document reaches agents, and each one reads ~1/3 of it. |
| **Identity fields never reach a scoring agent** | Contact details × 7 agents = 7× the tokens for zero signal. |
| **Metadata on the small model** (`llama-3.1-8b-instant`) | Extraction from pre-sectioned text does not need the 70B model. Frees TPM budget for the judgment agents. |
| **ExtractionAgent deleted** | It spent a full 70B call per evaluation pulling structured fields that the metadata agent now derives once, at ingest, on the cheap model, and persists. |
| **Debate only on real contradictions** | Was one large call on every proposal, unconditionally. |
| **Duplicate gate runs before evaluation** | Catching a duplicate costs one cheap LLM call. Evaluating it costs ~35,000 tokens. |
| **Idempotency** | SHA-256 on bytes (no reprocessing), and a completed evaluation is returned rather than re-run unless forced. Repeat clicks are free. |
| **Re-evaluation reads stored sections** | The document is never re-read. Evaluating a stored idea a year later costs the agent calls and nothing else. |

An evaluation of a real 13-page proposal costs **~35,000 tokens** across 10 calls.

### Latency and concurrency

- **`AsyncGroq`** — the event loop is no longer frozen for the duration of every LLM call.
- **7 parameter agents run in parallel** (bounded by a semaphore *and* the token budget).
  They are fully independent; the old code ran them strictly sequentially because the sync
  client would have blocked anyway.
- **Extraction passes run concurrently** — images, tables and page-OCR are independent and
  all CPU-bound; they now run together in threads instead of end-to-end on the event loop.
- **Scanned-PDF OCR opens the document once.** The old loop re-opened the PDF from bytes
  for *every page* — O(pages) full document parses for one scan.
- **Analytics overview fans out** with `asyncio.gather` in one round trip.

### Database

- **JSONB, not JSON-as-text.** Reports were `Text` + `json.dumps`, so the database could
  not see inside them; "every proposal whose financial sub-score is below 4" meant pulling
  every report into Python and parsing it.
- **HNSW index** over the embedding column — the similarity gate stays sub-linear as the
  archive grows year over year.
- **Denormalized `decision_year`/`decision_month`** — the timeline is an indexed grouping.
- **One engine, one pool.** Each repository used to construct its own `create_async_engine`
  — several independent connection pools competing for the same Postgres.
- **Full text lives in object storage**, with only a preview inlined, so list queries stop
  dragging megabytes of OCR output around.

---

## 7. The constraint that governs everything: Groq rate limits

Your account is on Groq's **free tier**, and this is now the binding limit on how fast an
evaluation can run.

| model | tokens/min | tokens/day |
|---|---|---|
| `llama-3.3-70b-versatile` (agents) | 12,000 | 100,000 |
| `llama-3.1-8b-instant` (metadata) | 6,000 | — |

Groq charges the **reservation** — `input + max_tokens`, not what the response actually
costs — against a rolling per-minute budget. Two distinct failures follow, and the
original code walked into both:

1. **A single request larger than the whole budget** → a hard 413 that no retry can fix.
   My first metadata call asked for 7,273 tokens against a 6,000 ceiling. The 70B agents
   would have asked ~13,000 against 12,000 — **all seven would have failed.**
2. **Requests that individually fit but collectively do not** → firing seven agents at
   once would burst ~28,000 tokens into a 12,000/minute budget, producing a cascade of
   429s that the backoff then serialises anyway, only slower.

I built a **TPM-aware rate limiter**: a true rolling 60-second window, reserve-then-
reconcile (an agent that answers in 400 tokens when allowed 2,000 gives the rest back), and
oversized requests rejected up front with a message saying what to change rather than
retried into a wall. It paced all 10 calls of a real evaluation with **zero 413s and zero
429s**.

The cost is wall-clock time: **an evaluation takes about 4 minutes**, almost all of it
spent waiting on the token budget rather than on inference.

> **The single highest-leverage change available to you is to raise your Groq tier and
> raise `LLM_TPM` / `LLM_TPM_FAST` in `config.py`.** No code changes. The limiter reads the
> numbers from config and goes as fast as the account allows.

The daily 100,000-token cap is also real — my testing exhausted it, which is what surfaced
the "blaming the applicant for our outage" bug. That bug is now fixed, but the cap will
bite you in production long before the per-minute one does.

---

## 8. Testing

**157 Python tests**, all passing. The suite was rewritten: the old one mocked internals
that no longer exist (it stubbed `get_text("text")` returning a string, for instance). The
new one tests the invariants the client's requirements actually depend on:

- `test_evidence.py` — fabricated quotes are dropped; a score without a citation is
  downgraded to unevidenced; unanswered is `null` and **never** 0; unevidenced questions
  are skipped in the mean rather than zeroed; a starved agent spends nothing and invents
  nothing; an agent only ever sees its own sections.
- `test_scoring.py` — the weights; unscored parameters renormalize rather than zeroing;
  the ±8 adjustment band is clamped; the blind prompt contains no identity; **and the
  five tests pinning failed-≠-unevidenced.**
- `test_sectioniser.py` — heading routing (including the `"Revenue Model"` and
  `"Founders Background"` regressions); word boundaries; identity never reaching an agent;
  an absent section is *absent*, not empty.
- `test_rate_limiter.py` — including the exact 7,273-against-6,000 request that produced a
  live 413.
- `test_registry.py` — company-name collapsing; the honest debate trigger.
- `test_decisions.py` — the approval vocabulary; PDF never renders a gap as `0.0`; stable
  parameter order.

Plus end-to-end verification against live Postgres and live Groq, driving the real
gateway: auth and RBAC (401/403/200 as appropriate), upload → extract → metadata →
duplicate gate, the original document streaming back as `application/pdf`, the approval
guardrails firing, the PDF rendering (checked visually, both pages), and the frontend
driven in a real browser with **no console errors**.

---

## 9. Running it

One command, either platform.

```bash
cp .env.example .env      # then set GROQ_API_KEY
./run.sh                  # Linux / macOS
```
```powershell
copy .env.example .env    # then set GROQ_API_KEY
.\run.ps1                 # Windows
```

That is the whole thing. The script checks your prerequisites, brings up Postgres (and
MinIO if you want it), creates the Python virtualenv, installs both npm trees, pre-warms
the tokenizer and the embedding model, starts all three services in dependency order,
seeds the two operator accounts, waits for each to answer a health check, and prints
where to go and how to sign in. Ctrl+C stops everything.

| | |
|---|---|
| `./run.sh` | start everything (installs whatever is missing) |
| `./run.sh --stop` | stop the services *and* the containers |
| `./run.sh --clean` | stop, and **destroy** the database and stored files |
| `./run.sh --setup` | install and prepare, but do not start |
| `./run.sh --no-docker` | use a Postgres you are running yourself |

Windows takes the same flags as `-Stop`, `-Clean`, `-Setup`, `-NoDocker`.

**Cold start** (empty machine): a few minutes, almost all of it pip and the 130MB
embedding model. **Warm start: ~10 seconds** — dependencies are only reinstalled when
`requirements.txt` or `package.json` actually change, and the seed is idempotent (it
upserts by email and never resets a password you have changed).

### One file to edit

`.env` at the repo root is the only file you touch. `backend/.env` and
`python-service/.env` are **generated from it** on every run — do not edit those; the
three used to drift apart, which is exactly the class of bug that makes an app work on
one machine and not another.

The only value you must supply is `GROQ_API_KEY`.

### Things that will bite you

**The Postgres volume must be recreated.** The image moved from `postgres:15-alpine` to
`pgvector/pgvector:pg16`, because the stock image has no `vector` extension and the
duplicate-idea gate cannot work without it. A PG15 data directory will not mount under
PG16, and the old `evaluations` / `proposals` tables would also collide with the new
schema — SQLAlchemy's `create_all` skips tables that already exist, so the new code would
silently run against the old shape and break on missing columns.

The script **detects this specific failure and tells you exactly what to do** rather than
timing out with "postgres did not become ready". Run `./run.sh --clean` once.

**Change the seeded passwords.** `ADMIN_PASSWORD` and `DESK2_PASSWORD` in `.env`. The
seed refuses to be quiet about the defaults.

**Delete the stale Firebase credential** — nothing references it any more:
`rm backend/firebase-service-account.json backend/data/ai_logs.json`

**Tesseract is optional but wanted.** Without it, scanned PDFs and images are not OCR'd.
The script warns and carries on. `sudo apt install tesseract-ocr`, `brew install
tesseract`, or the UB-Mannheim installer on Windows.

---

## 10. What I would do next

Roughly in order of value:

1. **Raise the Groq tier.** Everything else is second-order. A 4-minute evaluation becomes
   well under a minute, and the daily cap stops being a live hazard.
2. **Make `/evaluate` asynchronous.** It currently holds an HTTP connection for ~4 minutes.
   The `evaluations` row already opens *before* the agents run and the retry queue already
   finds stale `processing` rows, so the machinery is there — it wants a background task
   and a poll, exactly like ingestion.
3. **Alembic migrations.** The schema is created with `create_all`, which is fine now and
   will not be fine the first time you need to alter a column on a table holding two years
   of funding decisions.
4. **A proper job queue** (Redis/RQ, Celery) instead of FastAPI `BackgroundTasks`. A
   process restart mid-ingest currently loses the in-flight work; the row survives and is
   retryable, but nothing automatically picks it up.
5. **Cache LLM responses on `(model, prompt_hash)`.** Forced re-evaluations and retries
   re-pay full price today.
6. **Sub-question-level embeddings for retrieval.** Section routing is a large improvement
   on keyword scanning, but an agent still reads its whole section. Retrieving the top-k
   passages *per sub-question* would cut tokens again and sharpen citations.
7. **Push status over SSE/WebSocket** instead of polling. The frontend polls every 5–15s
   during processing.

---

## Appendix — what a real evaluation produces

The Dvara proposal (`aiaic (22).pdf`, 13 pages), evaluated through the full stack:

```
OVERALL: 75.5/100   Conditionally Recommended   evidence coverage 78%

PARAMETER                        SCORE     W   EVID  SECTIONS READ
Problem & Relevance               85.0  0.15  100%  problem, vision, adoption
Solution & Technology Readiness   70.0  0.20  100%  solution, pilot, compliance
Pilot Design & Feasibility        85.0  0.20   60%  pilot, financial, adoption
Farmer Adoption & Inclusion       76.0  0.15  100%  adoption, business_model, problem
Business Model & Scale-up         82.5  0.15   80%  business_model, financial, solution
Team & Capacity                   80.0  0.10   25%  team
Compliance & Governance           NONE  0.05    0%  compliance, solution
                                  ^^^^
                    not zero — the proposal is silent on it, and it is excluded
                    from the weighted mean rather than counted against them
```

With, behind every one of those numbers, the words from the document that produced it:

> **9.0/10** — *Is the scale and severity of the problem evidenced with concrete data?*
> “Claims under traditional schemes take 90–120 days” — *section: problem*

That is the difference this rebuild is really about.
