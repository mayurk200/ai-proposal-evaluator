# Agent Evaluation Pipeline — Complete Documentation

## Architecture Overview

The system uses a **multi-agent pipeline** with **9 specialized LLM-powered agents** coordinated by an `AgentOrchestrator`. Each agent is a prompt-driven Groq LLM call that returns structured JSON.

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 1: DOCUMENT INGESTION                      │
│                                                                     │
│  Upload (PDF/DOCX/PPTX/TXT/Images)                                │
│       ↓                                                             │
│  Document Processor (OCR + Text Extraction)                        │
│       ↓                                                             │
│  Strategic Chunking (financial / technical tags)                   │
│       ↓                                                             │
│  Output: DocumentChunks + Metadata + Summary                      │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 2: EXTRACTION                              │
│                                                                     │
│  🔍 Extraction Agent (temp=0.1)                                    │
│       → Extracts 18 structured fields from raw text                │
│       → Output enriches ALL subsequent agents                      │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│            STAGE 3: ANALYSIS (7 Agents, Sequential)                │
│                                                                     │
│  🎯 Problem Relevance Agent     (20% weight)                      │
│  ⚙️ Technical Soundness Agent   (20% weight)                       │
│  📋 Pilot Design Agent          (15% weight)                       │
│  👥 Team & Execution Agent      (15% weight)                       │
│  📈 Market Potential Agent      (10% weight)                       │
│  💰 Financial Sustainability    (10% weight)                       │
│  🌍 Strategic Impact Agent      (10% weight)                       │
│                                                                     │
│  Each agent runs sequentially with 1s delay (rate limit safety)    │
└─────────────────────────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    STAGE 4: FINAL SCORING                           │
│                                                                     │
│  🏆 Final Scoring Agent (temp=0.2)                                 │
│       → Cross-agent synthesis & contradiction detection            │
│       → SWOT analysis                                              │
│       → Binary recommendation: "Select" or "Reject"               │
│       → Weighted overall score computed in code (deterministic)    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1 — Document Processing (Pre-Agent)

**Entry Point**: `POST /api/v1/evaluate`

**File**: `python-service/app/api/routes.py`

### Process

1. User uploads a file (PDF, DOCX, PPTX, images, etc.)
2. The document processor extracts raw text, runs OCR on scanned content (via Tesseract), and extracts tables/images
3. Text is split into **strategic chunks** — each chunk is tagged with metadata:
   - `has_financial_data: bool` — chunks containing budget/cost/revenue data
   - `has_technical_content: bool` — chunks with technology/architecture details
   - `section_title`, `page_numbers`, `word_count`
4. An executive summary is generated
5. Output: `ProcessedDocument` with `chunks[]`, `metadata`, and `summary`

### Validation

- **Minimum text threshold**: If fewer than 20 words are extracted, the evaluation is rejected
- **File size limit**: Configurable via `MAX_FILE_SIZE_MB`
- **Supported formats**: PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG, JPEG, TIFF, BMP

---

## Stage 2 — Extraction Agent

**File**: `python-service/app/agents/extraction/extraction_agent.py`

| Setting | Value |
|---------|-------|
| Temperature | `0.1` (very deterministic — extracts facts, not opinions) |
| Max Tokens | `4096` |

### Extracted Fields (18 total)

| # | Field | Description | Example |
|---|-------|-------------|---------|
| 1 | `startup_name` | Company/startup name | "AgriSense Technologies" |
| 2 | `founders` | Team members with roles | `[{name, role, experience}]` |
| 3 | `problem_statement` | Problem being solved | "Post-harvest losses exceed 30% in Maharashtra" |
| 4 | `proposed_solution` | How they solve it | "IoT-based cold chain monitoring" |
| 5 | `target_market` | Customer segment | "Smallholder farmers in Vidarbha" |
| 6 | `industry_sector` | Sector classification | "AgriTech" |
| 7 | `business_model` | How they make money | "SaaS subscription per farm" |
| 8 | `revenue_streams` | Revenue sources | `["subscriptions", "data analytics"]` |
| 9 | `funding_requirements` | Funding ask | "₹50 lakhs for 18-month pilot" |
| 10 | `current_traction` | Existing progress | "200 farmers, 3 pilot districts" |
| 11 | `technology_used` | Tech stack | `["IoT", "TensorFlow", "AWS"]` |
| 12 | `sustainability_approach` | Sustainability plan | "Solar-powered sensors" |
| 13 | `competitive_advantages` | Moat/differentiation | `["proprietary dataset"]` |
| 14 | `key_metrics` | KPIs mentioned | `["30% yield improvement"]` |
| 15 | `timeline` | Milestones | `["Month 1-3: setup"]` |
| 16 | `team_size` | Team composition | "8 full-time" |
| 17 | `geographic_focus` | Location focus | "Maharashtra — Pune, Nashik" |
| 18 | `partnerships` | Collaborations | `["ICAR", "local FPOs"]` |

### Score Calculation

Score is based on **completeness** — how many of the 15 key fields are present vs. "Not specified":

```
Score = (fields_present / 15) × 100
```

### Critical Rules

- Extracts **ONLY** what is explicitly stated in the document
- Missing info is marked as `"Not specified"` or empty array
- Does NOT infer or make up information
- Vague/ambiguous claims tracked in `unclear_claims` array
- Missing critical info tracked in `missing_critical_info` array

### Output Usage

The extracted data becomes **context enrichment** for all subsequent agents. It is prepended as `EXTRACTED PROPOSAL DATA` to each agent's input alongside the relevant proposal text.

---

## Stage 3 — Seven Analysis Agents

All 7 agents run **sequentially** with a 1-second delay between each to respect Groq's TPM rate limits.

### Common Agent Behavior

Every agent inherits from `BaseAgent` (`python-service/app/agents/base_agent.py`):

- Receives the extracted data + relevant proposal text
- Calls the Groq LLM with its specialized system prompt
- Returns an `AgentResult` containing:
  - `score` (0-100)
  - `confidence` (0.0-1.0)
  - `analysis` (detailed text analysis)
  - `key_findings` (list of findings)
  - `red_flags` (list of concerns)
  - `recommendations` (list of suggestions)
  - `raw_output` (full JSON from LLM)
  - `tokens_used`, `duration_ms`, `status`

### Content Routing

- **Technical Agent** → receives only chunks tagged with `has_technical_content`
- **Financial Agent** → receives only chunks tagged with `has_financial_data`
- **All other agents** → receive the full content

If no chunks match a filter, ALL chunks are used as fallback.

---

### Agent 1: 🎯 Problem Relevance Agent (Weight: 20%)

**File**: `python-service/app/agents/problem_relevance_agent.py`

**Core Question**: *"Is this startup solving a real, significant problem relevant to Maharashtra?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `problem_realism` | Is this actually a real problem? |
| `regional_relevance` | Is the problem specific to Maharashtra? |
| `severity` | How severe/urgent is the problem? |
| `scalability` | Can the proposed solution realistically address it at scale? |

**Proposal Fields Considered**:
- Solution Synopsis
- Strategic impact on Maharashtra's agriculture
- Policy alignment
- Scale potential
- Sustainability
- Proposed Project Districts/Talukas in Maharashtra

**Critical Rules**:
- Assess the scale and severity of the problem
- Determine the percentage of the problem that is actually addressable
- Ensure the problem has specific relevance to Maharashtra

---

### Agent 2: ⚙️ Technical Soundness Agent (Weight: 20%)

**File**: `python-service/app/agents/technical/technical_agent.py`

**Core Question**: *"Is the technology real, mature, and genuinely needed?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `ai_dependency` | Is AI actually necessary or merely decorative? |
| `technical_novelty` | Is the tech novel or commodity? |
| `infrastructure_feasibility` | Is the architecture coherent? |
| `engineering_complexity` | Can this team build it? |
| `deployment_readiness` | Prototype vs MVP vs production? |
| `scalability` | Can it scale technically? |
| `existing_validation` | Prior pilots, POCs, user validation? |
| `defensibility` | Patent/IP status? |

**Proposal Fields Considered**:
- Solution Synopsis
- Technology explanation in detail
- TRL Level
- Current Customers/Pilots
- IP Status

**Critical Rules**:
- Is AI actually necessary or merely decorative?
- Is the technology feasible and architecture coherent?
- Assess prototype vs MVP vs production readiness
- Evaluate number of pilots, success metrics, user validation
- Check patent/IP status and defensibility

---

### Agent 3: 📋 Pilot Design Agent (Weight: 15%)

**File**: `python-service/app/agents/pilot_design_agent.py`

**Core Question**: *"Is the implementation plan realistic and well-designed?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `timeline_realism` | Can this timeline actually be met? |
| `operational_feasibility` | Is team execution capacity sufficient? |
| `cost_per_farmer` | Is cost justified per beneficiary? |
| `infrastructure_overpricing` | Excessive cloud/consulting/hardware costs? |
| `kpi_existence` | Are KPIs defined? |
| `quantifiable_targets` | Are targets measurable? |
| `technical_risks` | Tech risk assessment? |
| `operational_risks` | Operational risk assessment? |
| `climate_dependency` | Weather/climate risk? |

**Proposal Fields Considered**:
- Workplan & Milestones
- Number of farmers / Farmer groups / Land plots
- Scale targets, Project duration
- Total Project Cost, AIAIC support, Own/private funding
- Baseline values / Target values
- Measurement methods
- Risk Assessment & Mitigation

**Red Flag Detection**:
- Excessive cloud costs
- Large consulting fees
- Hardware inflation
- Missing evaluation methodology

---

### Agent 4: 👥 Team & Execution Agent (Weight: 15%)

**File**: `python-service/app/agents/team_agent.py`

**Core Question**: *"Can this team actually execute?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `founder_experience` | Startup/industry background |
| `technical_strength` | Engineering capability |
| `domain_expertise` | Agriculture understanding |
| `team_completeness` | Missing critical roles? |
| `advisory_support` | Mentors and industry advisors? |

**Proposal Fields Considered**:
- Team member profiles
- Past experience
- Role definitions
- Advisory board

---

### Agent 5: 📈 Market Potential Agent (Weight: 10%)

**File**: `python-service/app/agents/market_agent.py`

**Core Question**: *"Is there real commercial viability?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `revenue_realism` | Are revenue projections realistic? |
| `expansion_potential` | Growth opportunity beyond pilot? |
| `competitive_differentiation` | What's the moat? |
| `distribution_feasibility` | Can they reach farmers? |
| `pricing_viability` | Will farmers pay this price? |

**Proposal Fields Considered**:
- Market size estimates (TAM/SAM/SOM)
- Revenue models
- Pricing strategy
- Target audience demographics

**Critical Rules**:
- Check TAM/SAM/SOM realism and market demand
- Assess farmer adoption probability
- Evaluate scalability of revenue model and unit economics

---

### Agent 6: 💰 Financial Sustainability Agent (Weight: 10%)

**File**: `python-service/app/agents/financial/financial_agent.py`

**Core Question**: *"Is the financial plan sound?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `burn_rate` | How fast are they spending? |
| `revenue_projections` | Are projections realistic? |
| `grant_dependency` | Too dependent on grants? |
| `unit_economics` | Does the math work per unit? |
| `funding_strategy` | Is the funding plan viable? |
| `sustainability_timeline` | When do they become self-sustaining? |

**Proposal Fields Considered**:
- Burn rate
- Revenue projections
- Funding strategy
- Cost structure

**Critical Rules**:
- Flag unrealistic revenue growth or lack of monetization clarity
- Flag if there are no runway calculations or weak cost structure
- Assess unit economics and dependency on grants

---

### Agent 7: 🌍 Strategic Impact Agent (Weight: 10%)

**File**: `python-service/app/agents/strategic_impact_agent.py`

**Core Question**: *"What's the broader impact on Maharashtra's agriculture?"*

| Evaluation Criteria | What It Checks |
|---------------------|----------------|
| `potential_beneficiaries` | How many farmers benefit? |
| `state_level_impact` | Maharashtra-wide impact? |
| `long_term_scalability` | Sustainable at scale? |
| `esg_contribution` | Environmental/social/governance contribution? |

**Proposal Fields Considered**:
- Sustainability impact
- Water efficiency metrics
- Yield improvement projections
- Farmer income increase
- Climate resilience
- Policy alignment

---

## Stage 4 — Final Scoring Agent (Synthesis)

**File**: `python-service/app/agents/scoring/scoring_agent.py`

| Setting | Value |
|---------|-------|
| Temperature | `0.2` (very deterministic) |
| Role | Senior venture analyst & evaluation committee lead |

### Input

Receives the **compiled results of ALL 8 previous agents** as JSON:
- Scores from each agent
- Full analysis text
- Key findings
- Red flags
- Recommendations
- Raw sub-scores (numeric values)

### What It Does

1. **Synthesizes** all findings into a coherent assessment
2. **Cross-references** agent outputs for **consistency** — flags contradictions
3. **Generates weighted scores** for all 7 parameters
4. **Identifies the top 3 make-or-break factors**
5. **Makes a binary recommendation**: exactly `"Select"` or `"Reject"`
6. **Generates SWOT analysis** (Strengths, Weaknesses, Opportunities, Threats)
7. **Assesses investment readiness**: `"Ready"`, `"Needs Work"`, or `"Not Ready"`
8. **Assigns risk level**: `"Low"`, `"Medium"`, `"High"`, or `"Critical"`

### Strict Rejection Bias

> **"If the project is not absolutely perfect and highly outstanding across all parameters, you MUST reject it. Only select projects that are truly exceptional."**

This ensures a high bar for selection — only truly outstanding proposals pass.

---

## Weighted Scoring Formula

The orchestrator (`python-service/app/agents/orchestrator.py`) computes the final overall score using a **fixed weighted average** — NOT the scoring agent's own overall score:

```
Overall Score = 
    Problem Relevance        × 0.20
  + Technical Soundness      × 0.20
  + Pilot Design             × 0.15
  + Team Capability          × 0.15
  + Market Potential         × 0.10
  + Financial Sustainability × 0.10
  + Strategic Impact         × 0.10
  ─────────────────────────────────
                              = 1.00
```

### Score Source Priority

For each parameter score:
1. **First**: Use the scoring agent's output score (from its cross-agent analysis)
2. **Fallback**: Use the individual agent's own score

### Recommendation Enforcement

The recommendation from the scoring agent must be exactly `"Select"` or `"Reject"`. Any other value defaults to `"Reject"`.

---

## Data Flow — Sequence

```
User uploads file
    ↓
POST /api/v1/evaluate
    ↓
Document Processor
    → OCR (Tesseract)
    → Text extraction
    → Strategic chunking
    → Summary generation
    ↓
Orchestrator.evaluate()
    ↓
Step 1: Build content views
    → full_content (all chunks)
    → financial_content (financial-tagged chunks)
    → technical_content (technical-tagged chunks)
    ↓
Step 2: Extraction Agent
    → Input: full_content + metadata
    → Output: 18 structured fields
    → Enriched content = extracted data + original text
    ↓
Step 3: Analysis Agents (sequential, 1s delay)
    → Problem Relevance Agent  ← enriched_content
    → Technical Agent           ← enriched_technical (filtered chunks)
    → Pilot Design Agent        ← enriched_content
    → Team Agent                ← enriched_content
    → Market Agent              ← enriched_content
    → Financial Agent           ← enriched_financial (filtered chunks)
    → Strategic Impact Agent    ← enriched_content
    ↓
Step 4: Compile all agent results
    → Aggregate scores, analyses, findings, red_flags
    ↓
Step 5: Final Scoring Agent
    → Input: all agent results as JSON
    → Output: final scores, SWOT, recommendation
    ↓
Step 6: Build FinalEvaluation
    → Compute weighted overall score (in code)
    → Enforce Select/Reject recommendation
    → Package all results
    ↓
Return EvaluationResponse to frontend
```

---

## LLM Infrastructure

**File**: `python-service/app/services/llm/llm_client.py`

| Setting | Value |
|---------|-------|
| Provider | **Groq** (fast inference) |
| Model | Configured via `LLM_MODEL` environment variable |
| Response Format | **JSON mode** enforced on every call |
| Retries | **5 attempts** with exponential backoff (2s → 60s) |
| Rate Limit Handling | Auto-retry on HTTP 429 errors |
| JSON Parsing | Handles markdown code blocks, extracts JSON from mixed text |
| Client Pattern | **Singleton** — one instance shared across all agents |

### JSON Response Parsing

The LLM client handles common LLM response formatting issues:
1. Strips markdown code block wrappers (` ```json ... ``` `)
2. Attempts `json.loads()` on cleaned text
3. If that fails, uses brace-matching to extract the first complete JSON object
4. If all parsing fails, returns an error dict with the raw text

---

## Final Output Structure

The `FinalEvaluation` model returned to the frontend:

| Field | Type | Description |
|-------|------|-------------|
| `overall_score` | `float` | Weighted average (0-100) |
| `problem_relevance_score` | `float` | 0-100 |
| `technical_soundness_score` | `float` | 0-100 |
| `pilot_design_score` | `float` | 0-100 |
| `team_capability_score` | `float` | 0-100 |
| `market_potential_score` | `float` | 0-100 |
| `financial_sustainability_score` | `float` | 0-100 |
| `strategic_impact_score` | `float` | 0-100 |
| `recommendation` | `string` | `"Select"` or `"Reject"` |
| `summary` | `string` | Executive summary |
| `strengths` | `list[str]` | Top strengths |
| `weaknesses` | `list[str]` | Top weaknesses |
| `swot_analysis` | `SWOTAnalysis` | Full SWOT (strengths, weaknesses, opportunities, threats) |
| `key_points` | `list[str]` | Critical decision points |
| `invalid_claims` | `list[str]` | Claims that don't hold up |
| `investment_readiness` | `string` | Ready / Needs Work / Not Ready |
| `key_action_items` | `list[str]` | Next steps for evaluation committee |
| `risk_level` | `string` | Low / Medium / High / Critical |

---

## Key Design Decisions

1. **Sequential execution** (not parallel) — Groq has TPM rate limits; parallel calls would hit them frequently
2. **Content filtering** — Financial and Technical agents get only relevant chunks, reducing noise and token usage
3. **Extraction-first architecture** — The extraction agent's structured output enriches all subsequent agents, giving them both structured context and raw text
4. **Deterministic scoring** — Low temperatures (0.1–0.3) ensure consistent evaluations across runs
5. **Strict rejection bias** — The system is intentionally strict; only truly exceptional proposals get "Select"
6. **Weighted formula in code** — The overall score is computed by the orchestrator (not the LLM) to ensure deterministic, auditable scoring
7. **Graceful failure** — If any agent fails, it returns a zero-score `AgentResult` with the error message, and the pipeline continues

---

## File Reference

| File | Purpose |
|------|---------|
| `python-service/app/agents/orchestrator.py` | Pipeline coordinator, weighted scoring |
| `python-service/app/agents/base_agent.py` | Base class for all agents |
| `python-service/app/agents/extraction/extraction_agent.py` | Data extraction agent |
| `python-service/app/agents/problem_relevance_agent.py` | Problem relevance evaluation |
| `python-service/app/agents/technical/technical_agent.py` | Technical soundness evaluation |
| `python-service/app/agents/pilot_design_agent.py` | Pilot design evaluation |
| `python-service/app/agents/team_agent.py` | Team capability evaluation |
| `python-service/app/agents/market_agent.py` | Market potential evaluation |
| `python-service/app/agents/financial/financial_agent.py` | Financial sustainability evaluation |
| `python-service/app/agents/strategic_impact_agent.py` | Strategic impact evaluation |
| `python-service/app/agents/scoring/scoring_agent.py` | Final scoring & synthesis |
| `python-service/app/services/llm/llm_client.py` | Groq LLM client with retries |
| `python-service/app/models/schemas.py` | Pydantic data models |
| `python-service/app/api/routes.py` | FastAPI endpoints |
