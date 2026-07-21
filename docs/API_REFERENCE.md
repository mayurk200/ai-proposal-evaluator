# API Reference

Two services. The **Node gateway** on port 3001 is the only one a browser talks to: it
authenticates the request, enforces the role rules, and forwards everything else to the
**Python service** on port 8000, stamping the caller's identity on the way through so a
decision is always attributable.

Every gateway route below is `/api/...` and requires `Authorization: Bearer <jwt>`. The
gateway wraps successful responses as `{"status": "success", "data": ...}` and errors as
`{"status": "error", "message": "..."}`. Paths map one-to-one onto the Python service's
`/api/v1/...`, so `POST /api/proposals/bulk/evaluate` reaches
`POST /api/v1/proposals/bulk/evaluate`.

---

## The shape of the system

Work does not happen inside a request. Uploading a document, or asking for an
evaluation, **enqueues a job** and returns immediately; a worker pool inside the Python
service drains the queue from a table in Postgres.

This is deliberate, and most of the API design follows from it. An evaluation is several
minutes of rate-limited LLM calls. Holding an HTTP connection open for it made the work
hostage to the client: close the tab, or hit the gateway's timeout, and the run was
orphaned with nothing recorded. Now the caller can disconnect, the server finishes, and
the result is on the proposal when they come back. A job whose worker dies is reclaimed
and retried rather than lost.

The practical consequence for a client: **poll, do not await.** `POST .../evaluate`
returns a `job_id` in about 100ms. Watch `GET /api/proposals/{id}` for `status` to reach
`evaluated`, or watch the job.

---

## Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | `{email, password}` → `{user, token}` |
| `GET` | `/api/auth/profile` | The current user |

There is no registration endpoint. Accounts are seeded server-side — this is an internal
console, and anyone who could sign themselves up could read every proposal and every
funding decision.

Two roles. **ADMIN** decides: resolves the duplicate gate, rules ideas duplicates,
approves, rejects, marks funding, deletes. **DESK2** may upload, process, retry, evaluate
and read everything, but may not decide. The gateway enforces this by method and path;
the UI only hides the buttons.

---

## Proposals

### `POST /api/proposals/upload`

Multipart, field name `files`, up to 25 per request. Returns `202` once the bytes are
stored and a row exists for each file — extraction, metadata and the duplicate check are
queued, not done.

```json
{ "batch_id": "…|null", "total": 3, "accepted": 2, "duplicates": 1,
  "proposals": [{ "proposal_id": "…", "filename": "…", "status": "uploaded",
                  "deduplicated": false }] }
```

`deduplicated: true` means those exact bytes are already in the archive; the existing
proposal is returned and nothing is reprocessed. A multi-file upload is grouped under a
`batch_id` whether or not one was supplied.

### `GET /api/proposals`

Paginated, filtered and **sorted server-side**. Sorting a page in the client would be a
lie — page 2 of "highest score first" would be the wrong rows.

| Parameter | Default | Notes |
|---|---|---|
| `page`, `limit` | `1`, `25` | `limit` max 200 |
| `status` | — | One status, or several comma-separated |
| `review_decision` | — | `pending` \| `approved_for_eval` \| `skipped_duplicate` |
| `is_evaluated` | — | Boolean |
| `category_id`, `company_id`, `batch_id` | — | |
| `search` | — | Title, filename and problem statement |
| `exclude_duplicates` | `false` | Hide ideas an admin ruled duplicates |
| `sort_by` | `created_at` | `created_at`, `updated_at`, `title`, `filename`, `status`, `score`, `evaluated_at`, `pages`, `words` |
| `sort_order` | `desc` | `asc` \| `desc` |

Sortable columns are allow-listed; an unknown value falls back to newest-first rather
than reaching `getattr`. Unscored proposals sort last in **both** directions — an
unevaluated idea is not "the worst one", it simply has no score.

`is_evaluated=false&exclude_duplicates=true` is the working list: ideas we hold metadata
for, have never scored, and have not ruled out.

Rows carry the current verdict denormalized (`latest_score`, `latest_recommendation`,
`latest_evaluation_id`, `evaluated_at`) so a listing never joins the report table.

### `GET /api/proposals/{id}`

One proposal with its evaluation history, latest report, decision, similarity matches,
and the company's approval record — the last travels with the proposal rather than being
a separate page an evaluator might not open.

### Other proposal routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/proposals/{id}/file` | Streams the original. `?download=1` forces a save |
| `GET` | `/api/proposals/{id}/similar` | Matches, with the reason each was flagged |
| `POST` | `/api/proposals/{id}/retry` | Re-runs processing on a **failed** proposal from the stored bytes |
| `DELETE` | `/api/proposals/{id}` | **ADMIN.** Deletes the proposal and its artifacts |

---

## The duplicate gate

Two different things, deliberately kept apart.

**The gate** is the machine's suspicion. Ingestion embeds the *substance* of an idea —
its problem and its solution, not the document's wording — and anything above the
similarity threshold stops for a human.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/review-queue` | Everything awaiting a ruling |
| `POST` | `/api/proposals/{id}/review` | **ADMIN.** `{evaluate: bool, note?}` |

**A ruling** is a human's judgement, and it applies to any stored idea — including ones
the gate never flagged, which is the case the gate cannot cover: two subsidiaries of one
group, a pilot re-pitched as a scale-up, a programme resubmitted with a fresh problem
statement.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/proposals/{id}/duplicate` | **ADMIN.** `{is_duplicate, duplicate_of?, note?}` |
| `POST` | `/api/proposals/bulk/duplicate` | **ADMIN.** `{proposal_ids[], is_duplicate, note?}` |

Both are reversible and neither deletes anything: the row, the metadata and the extracted
text stay, so the idea remains searchable and can be restored. It simply leaves the
working list and never costs an evaluation.

Marking an **already-evaluated** idea a duplicate is refused — that would hide a scored
result. Reject it instead.

---

## Evaluation

### `POST /api/proposals/{id}/evaluate`

Body `{force?: bool}`. Queues the agent pipeline and returns:

```json
{ "proposal_id": "…", "job_id": "…", "status": "queued", "already_queued": false }
```

`already_queued: true` means an evaluation was already pending for this proposal — a
double-click costs nothing. `force` re-runs a proposal that already has a completed
evaluation; without it, the stored report is kept.

Refused with `400` and a reason an operator can act on when the proposal is awaiting a
duplicate ruling, has been ruled a duplicate, is still processing, has failed, or is
already evaluated without `force`. Note that `force` means "score it again" — it does
**not** override the duplicate gate.

Works on any ingested proposal, including one uploaded months ago and never evaluated:
sections were persisted at ingestion, so this costs the agent calls and nothing else. No
re-upload.

### `POST /api/proposals/bulk/evaluate`

`{proposal_ids: [...], force?: bool}`, up to 500. Reports per item:

```json
{ "requested": 43, "queued": 37, "skipped": 6,
  "queued_items":  [{ "proposal_id": "…", "job_id": "…" }],
  "skipped_items": [{ "proposal_id": "…", "title": "…",
                      "reason": "Already evaluated — re-run it explicitly to score it again" }] }
```

The skipped items are the interesting ones; a bare count would not tell a caller whether
anything needs doing.

### Other evaluation routes

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/proposals/{id}/evaluate/retry` | Retry a failed evaluation. Budget-limited |
| `GET` | `/api/evaluations` | Paginated run history |
| `GET` | `/api/evaluations/{id}` | One report, with every agent's cited evidence |
| `GET` | `/api/evaluations/{id}/export` | PDF, carrying the evidence and not just the numbers |
| `GET` | `/api/retry-queue` | Everything that failed, with `can_retry` |
| `GET` | `/api/batches/{id}` | Batch progress |
| `POST` | `/api/batches/{id}/evaluate` | Queues every proposal in the batch that has cleared the gate |

---

## The work queue

Since processing left the request cycle, this is how a client answers "is anything
actually happening?".

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/jobs` | Filter by `status`, `kind` (`ingest` \| `evaluate`), `proposal_id`. Open work sorts first |
| `GET` | `/api/jobs/stats` | Depth by kind and status. Cheap enough to poll |
| `GET` | `/api/jobs/{id}` | One job, with attempts and error |
| `POST` | `/api/jobs/{id}/cancel` | Only a job that has **not started**. A running one is already spending tokens, and killing it would leave half an evaluation |

Jobs carry `attempts`/`max_attempts`. A failure is requeued with a backoff (1, 2, 4
minutes) rather than retried immediately, because most failures at this layer are a rate
limit and retrying instantly just burns the remaining attempts against the same wall.

Ingest jobs outrank evaluations by priority, and the worker reserves slots for them, so a
backlog of ten-minute evaluations cannot delay the cheap work that turns an upload into
something an admin can rule on.

---

## Decisions

The approval ledger is append-only. An idea approved in March and defunded in June still
counts as a March approval, because that is what happened.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/proposals/{id}/conflicts` | Read-only: what approving this would collide with |
| `POST` | `/api/proposals/{id}/decision` | **ADMIN.** `{decision, notes?, acknowledge_conflicts?}` |
| `POST` | `/api/proposals/{id}/funding` | **ADMIN.** `{selected, notes?, acknowledge_conflicts?}` |

`decision` is `approved` \| `rejected` \| `selected_for_funding` \| `unselected`.

Approving into a category that already holds an approval, or from a company that has
already won, returns **409** with the specific conflict:

```json
{ "status": "error",
  "message": "…",
  "details": { "message": "…",
               "conflicts": [{ "type": "category_already_approved",
                               "existing_approvals": [ … ] }] } }
```

Call `/conflicts` first to warn before the click. To override, resend with
`acknowledge_conflicts: true` — the override is recorded in the audit log against the
caller's account.

---

## Analytics

Two families, with different truth sources. Approval history is the append-only ledger
and must never change retroactively. Pipeline state is the current state of proposals,
evaluations and jobs, and is expected to move while you watch it.

| Method | Path | Answers |
|---|---|---|
| `GET` | `/api/analytics/overview` | Everything a dashboard needs in one round trip: totals, queue depth, pipeline stages, categories, companies, timeline |
| `GET` | `/api/analytics/categories` | (d) Approvals per category |
| `GET` | `/api/analytics/companies` | (e) Approvals per company, with `multi_category` |
| `GET` | `/api/analytics/timeline` | (f) Approvals by year and month. `group_by=category\|company` |
| `GET` | `/api/analytics/pipeline` | Where every idea currently sits, in lifecycle order |
| `GET` | `/api/analytics/scores` | Distribution by band, median and range, average per category, and the highest-scoring ideas with no decision recorded |
| `GET` | `/api/analytics/throughput` | Received vs scored per month. The gap is the backlog |
| `GET` | `/api/analytics/operations` | Tokens per evaluation, evidence coverage, failures grouped by stage, and what the duplicate gate saved |

`/analytics/operations` reports `estimated_tokens_saved` as `null` rather than a made-up
number when nothing has been evaluated yet and there is no average to estimate from.

---

## System

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Gateway + AI service reachability. Unauthenticated |
| `GET` | `/api/system` | Live dependency status and the running configuration |

`/api/system` reports the actual scoring model, token budget, similarity threshold,
worker slots and accepted formats — read from the running service, not hardcoded. Secrets
are reported as present or absent, never echoed.

Health distinguishes hard dependencies from soft ones. Database or storage down means we
cannot accept or record a proposal at all: that is a `503`. The LLM being down is
*degraded*, not dead — ingestion, listing and review still work, only evaluation stops.

---

## Proposal lifecycle

```
uploaded → extracting → extracted → metadata_ready ─┬→ pending_review → queued → evaluating → evaluated
                                                    └→ queued ───────────────↗
        (any stage) ─────────────────────→ failed        (admin ruling) ─────→ skipped
```

A row exists from the moment the bytes land, and it keeps that row whether or not it is
ever evaluated. Nothing is marked successful because an upload landed. A failure keeps
the stage it died at, the reason, and a retry counter — it stays queryable and retryable
rather than vanishing.

---

## Scoring

Seven AIAIC parameters, **weighted** (not the flat average an earlier version of this
document described):

| Parameter | Weight |
|---|---|
| Solution & Technology Readiness | 20% |
| Pilot Design & Feasibility | 20% |
| Problem & Relevance | 15% |
| Farmer Adoption & Inclusion | 15% |
| Business Model & Scale-up | 15% |
| Team & Capacity | 10% |
| Compliance & Governance | 5% |

A parameter score is the mean of its sub-scores, and every sub-score carries a verbatim
quote from the proposal. Quotes are checked against the source document; an invented one
is discarded, and if that leaves a sub-question with no evidence, it loses its score.

Three outcomes are never collapsed into each other:

- **a number** — we assessed it.
- **`null`, status `unevidenced`** — the proposal is silent. Excluded from the weighted
  mean, not counted as zero. Zero would mean "they answered, and it was terrible" — a
  different and far more damaging claim.
- **`null`, status `failed`** — *we* could not assess it (a rate limit, a timeout).
  Reported separately as our failure, never as the applicant's, and the report says the
  assessment is incomplete.
