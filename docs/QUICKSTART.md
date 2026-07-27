> [!WARNING]
> **Superseded — this document describes the system before the 2026 rebuild.**
>
> It refers to things that no longer exist: the Node.js fallback agent pipeline, Firebase
> Firestore, the 9-agent taxonomy, chunk-based processing, and the open registration flow.
> Following it will mislead you.
>
> The current design is in **[REPORT.md](../REPORT.md)**; setup is in **[README.md](../README.md)**.

# 🚀 QUICKSTART — Get AI Proposal Evaluator Running in 5 Minutes

This guide walks you through starting all 3 services and evaluating your first proposal on the frontend.

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| **Node.js** | ≥ 18 | `node --version` |
| **Python** | ≥ 3.10 | `python3 --version` |
| **Tesseract OCR** | ≥ 4.0 | `tesseract --version` |
| **Groq API Key** | — | [Get one here](https://console.groq.com/keys) |
| **Firebase Service Account** | — | Place `firebase-service-account.json` in `backend/` |

### Install System Dependencies (OCR)

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y tesseract-ocr tesseract-ocr-eng poppler-utils libmagic1

# macOS
brew install tesseract poppler libmagic

# Verify
tesseract --version
```

---

## Step 1: Start the Python AI Service (Port 8000)

```bash
# Navigate to python service
cd python-service

# Create virtual environment & install dependencies
python3 -m venv venv
source venv/bin/activate     # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `python-service/.env` — set your Groq API key:

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

Start the service:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

✅ **Verify:** Open [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health) — you should see:

```json
{
  "status": "ok",
  "services": {
    "llm": "connected",
    "tesseract_ocr": "available"
  }
}
```

> **Swagger Docs:** Interactive API docs available at [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Step 2: Start the Node.js Backend (Port 3001)

Open a **new terminal**:

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Edit `backend/.env` — set your Groq key and Python service URL:

```env
GROQ_API_KEY="gsk_your_groq_api_key_here"
PYTHON_SERVICE_URL=http://localhost:8000
FIREBASE_PROJECT_ID=project1-b1218
```

> **Note:** Ensure `firebase-service-account.json` exists in `backend/`.

Start the backend:

```bash
npm run dev
```

✅ **Verify:** You should see `Server running on port 3001` in the terminal.

---

## Step 3: Start the Frontend (Port 5173)

Open a **new terminal**:

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

✅ **Verify:** Open [http://localhost:5173](http://localhost:5173) — you should see the landing page.

---

## Step 4: Evaluate Your First Proposal 🎯

### 4a. Register / Login

1. Open [http://localhost:5173](http://localhost:5173)
2. Click **"Get Started"** or **"Sign Up"**
3. Register with any email/password
4. Log in with your credentials

### 4b. Upload & Evaluate

1. Navigate to the **Upload** page (from the sidebar or nav)
2. **Drag & drop** or click to upload a proposal document
   - Supported formats: **PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, TIFF, BMP**
   - Try the included test docs: `documents/Startup Proposal-1-AIAIC.pdf` or `documents/Startup Proposal-2-AIAIC.pdf`
3. Optionally enter a **title** for the proposal
4. Click **"Evaluate"**

### 4c. What Happens Behind the Scenes

```
Frontend → Node.js Backend → Python Service
                                  ↓
                         1. Text Extraction (PyMuPDF / python-docx)
                         2. OCR on scanned pages & images (Tesseract)
                         3. Layout & Form Field Extraction (form_field_extractor)
                         4. Strategic Section-Aware Chunking
                         5. Executive Summary Generation (Groq LLM)
                         6. 7 Parameter Agents + Debate + Scoring run sequentially:
                            • Problem Relevance Agent
                            • Solution Readiness Agent
                            • Pilot Design Agent
                            • Farmer Adoption Agent
                            • Scale-up Agent
                            • Team Capacity Agent
                            • Compliance Agent
                            • Debate Agent (Conditional dispute resolution)
                            • Scoring Agent (SWOT & Final Consolidator)
                         7. Flat Average Score & Adjustments Integration
                                  ↓
                    Results returned to Frontend ← Node.js ← Python
```

> ⏱️ **Expected time:** 30–90 seconds depending on document size and Groq API latency.

### 4d. View Results

After evaluation completes, you'll see:

- **Overall Score** (0–100)
- **7 AIAIC Parameter Scores**: Problem Relevance, Solution Readiness, Pilot Design, Farmer Adoption, Scale-up Potential, Team Capacity, Compliance
- **Debate Insights**: Highlights of any scoring disagreements resolved by the Debate Agent, with score adjustment logs
- **Recommendation**: Highly Recommended / Recommended / Conditionally Recommended / Not Recommended
- **SWOT Analysis**: Strengths, Weaknesses, Opportunities, Threats
- **Detailed Parameter Rubrics**: Expandable accordions detailing sub-question scores, explanations, and literal quotes (source evidence) extracted from the document

---

## All Three Terminals at a Glance

| Terminal | Directory | Command | Port |
|---|---|---|---|
| 1 — Python AI Service | `python-service/` | `source venv/bin/activate && uvicorn app.main:app --port 8000 --reload` | 8000 |
| 2 — Node.js Backend | `backend/` | `npm run dev` | 3001 |
| 3 — React Frontend | `frontend/` | `npm run dev` | 5173 |

---

## Quick Test via CLI (No Frontend Needed)

You can also test the Python service directly:

```bash
# Health check
curl http://localhost:8000/api/v1/health

# Process a document (extraction + chunking only)
curl -X POST http://localhost:8000/api/v1/process-document \
  -F "file=@AI_Proposal_Scrutiny_Use_Case_Document.docx" \
  -F "generate_summary=false"

# Full evaluation (extraction + chunking + 9 agents)
curl -X POST http://localhost:8000/api/v1/evaluate \
  -F "file=@your_proposal.pdf"
```

---

## Troubleshooting

### Python service says "LLM disconnected"
→ Your `GROQ_API_KEY` is missing or invalid. Check `python-service/.env`.

### Python service says "tesseract_ocr: unavailable"
→ Install Tesseract: `sudo apt install tesseract-ocr tesseract-ocr-eng`

### Frontend shows blank page or CORS errors
→ Ensure all 3 services are running. The frontend proxies `/api` → `localhost:3001`.

### Backend says "Python service unavailable, using Node.js fallback"
→ Python service on port 8000 isn't running. Start it first. The backend will still work using its legacy pipeline, but without OCR, chunking, or the expanded 9-agent evaluation.

### Evaluation takes too long
→ Groq free tier has rate limits. The 9 agents run sequentially with delays. For large documents, expect 60–120 seconds.

### "Could not extract sufficient text from the file"
→ The document has very little readable text. Try a different file, or ensure OCR is working for scanned PDFs.

---

## Docker (Optional)

To run everything in Docker:

```bash
# From project root
docker-compose up --build
```

This starts all 3 services. Access the frontend at [http://localhost:3000](http://localhost:3000).

> **Note:** Set `GROQ_API_KEY` in a root `.env` file or pass it via environment variables.
