# How the Ranking System Works

This document explains the two numbers the platform uses — **score** and
**rank** — where they come from, and how the **Rankings** view on the
Proposals page is computed.

## Terminology

| Term | What it is | Where it appears |
| --- | --- | --- |
| **Score** | The AI agent's 0–100 triage signal for one proposal | List view badge, card details, "More info" modal |
| **Rank** | A *position* (#1, #2, #3 …) computed by comparing scores or file counts | Rankings view only (leaderboard + category standings) |

> Note: for historical reasons the API field that carries the score is named
> `rank` (`proposals.rank` column, `rank` in JSON responses). The UI labels it
> "Score" everywhere.

## 1. The score (0–100, per proposal)

Every uploaded proposal that finishes processing gets a **score from 0 to
100**, assigned by the AI categorization agent. It is a *quick first-pass
signal* of how complete and promising the proposal looks — **not** a formal
evaluation result.

From the agent's instructions
(`python-service/app/agents/categorization/categorization_agent.py`):

> "rank" is a quick 0-100 triage signal of how complete/promising the proposal
> looks at a glance (data present, clarity, ambition). It is NOT a formal
> evaluation score — keep it rough.

How it is produced:

1. **Upload** — the file is stored in MinIO via the Node backend.
2. **Processing** — the Python service extracts the text (OCR when needed).
3. **Categorization agent** — the extracted text goes to the LLM (Groq), which
   returns one JSON object with the title, summary, agri categories, flags,
   the **score (0–100 integer)** and a **confidence (0.0–1.0)**.
4. **Validation** — the service clamps the score to 0–100
   (`max(0, min(100, rank))`).
5. **Persistence** — stored on the `proposals.rank` column in PostgreSQL.

Failed proposals keep score 0 and never appear in rankings. The score is
color-coded wherever it is shown: **80–100 green**, **60–79 amber**,
**0–59 red**.

## 2. The Rankings view

The **Rankings** toggle on the Proposals page always works from the **full
proposal set** (not the currently filtered list), so every category can be
compared against the total number of files. It has two parts:

### Category standings — ranked by share of total files

Each category is ranked by **how many of the total files fall into it**:

- **Files in category / total files** — e.g. "3 of 12 files", with a share
  bar (25 %). A proposal with multiple categories counts once in each of its
  categories.
- **Average score** — the mean score of the category's scored proposals,
  used as the tie-breaker when two categories hold the same number of files
  (final tie-break: alphabetical).
- Positions 1–3 get gold/silver/bronze tiles.
- Clicking a category card filters the leaderboard below to that category
  (clicking it again clears the filter).

### Proposal leaderboard — ranked by score

- **Who is included** — only proposals with status `categorized` and
  score > 0. Processing and failed rows are excluded.
- **Order** — highest score first. Ties are broken by upload time, newest
  first, so fresh submissions surface.
- **Positions** — every entry shows `#position of N`. With no category
  selected, positions are **overall** (out of all ranked files). With a
  category selected, positions are **within that category** (out of the files
  in that category).
- The search box applies to the leaderboard; positions are recomputed over
  the visible set.

## Score vs. full evaluation

The triage score is not the multi-agent evaluation:

| | Triage score | Evaluation overall score |
| --- | --- | --- |
| Produced by | Categorization agent (single LLM call) | Full pipeline (7 parameter agents + debate + scoring) |
| When | Automatically on upload/processing | Only when an evaluation is explicitly run |
| Stored in | `proposals.rank` | `evaluations.overall_score` |
| Shown | Proposals page (score badge + Rankings view) | Dashboard, Analytics, Compare pages |

## Confidence and review flags

Next to the score the agent reports a **confidence** (0–100 %, shown in the
expanded card details and the "More info" modal). Low confidence usually means
short or ambiguous extracted text — treat such scores with skepticism. The
agent may also set the `needs_review` flag, shown as a badge on the card.

## Re-scoring a proposal

The score is assigned once, when categorization completes. To get a fresh
score (e.g. after fixing a failed run or updating the document): delete the
proposal (Delete button on its card — removes the database row **and** its
stored files) and upload it again.

## Where to find it in the code

| Piece | Location |
| --- | --- |
| Agent prompt (defines score semantics) | `python-service/app/agents/categorization/categorization_agent.py` |
| Score clamping/validation | same file, `_parse_result` |
| Persistence | `python-service/app/services/processing/categorization_service.py`, `proposals.rank` column |
| API (list/detail with score) | `GET /api/uploads/processed`, `GET /api/uploads/processed/:id` |
| Delete (row + stored files) | `DELETE /api/uploads/processed/:id` → Python `DELETE /api/v1/proposals/:id` |
| Rankings UI (standings + leaderboard) | `frontend/src/pages/ProposalsPage.tsx` (`RankingBoard`) |
