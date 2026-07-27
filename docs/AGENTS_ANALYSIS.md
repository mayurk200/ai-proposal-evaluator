> [!WARNING]
> **Superseded — this document describes the system before the 2026 rebuild.**
>
> It refers to things that no longer exist: the Node.js fallback agent pipeline, Firebase
> Firestore, the 9-agent taxonomy, chunk-based processing, and the open registration flow.
> Following it will mislead you.
>
> The current design is in **[REPORT.md](../REPORT.md)**; setup is in **[README.md](../README.md)**.

# Multi-Agent Analysis — AIAIC System Architecture

This document evaluates the design, role, strengths, and future improvement vectors of each agent in the active evaluation pipeline.

---

## 1. Orchestrator (`orchestrator.py`)
**Purpose:** Manages the sequential/parallel pipeline execution.
- Extracts document structure and key metadata (via `ExtractionAgent`).
- Executes the **7 Parameter Agents** sequentially (building rate-limit buffers).
- Intercepts scores and triggers the **Debate Agent** when score differences or ambiguity thresholds are met.
- Feeds all insights to the **Scoring Agent** for consolidation.

**Strengths:**
- High fault tolerance: isolated agent execution prevents complete evaluation failures.
- Rate-limit aware: implements dynamic pauses to respect free-tier Groq limitations.
- Dispute interception: automatically detects discrepancies in parameter scores before final rendering.

**Future Improvements:**
- Parallelize independent parameter agents using asyncio when token/rate-limits allow.
- Add active checkpointing to resume failed evaluations from the last completed agent.

---

## 2. BaseAgent (`base_agent.py`)
**Purpose:** The abstract foundation class providing uniform prompt formatting, Groq client wrapper, exponential-backoff retries, and structured JSON schema parsing.

**Strengths:**
- Ensures consistent error handling and retry behaviors across the system.
- Robust JSON-repair routines when LLM outputs contain formatting mistakes.

**Future Improvements:**
- Implement caching to prevent duplicate LLM calls on identical text chunks.
- Add automatic LLM parameter tuning (e.g., lower temperature during strict extraction vs. higher temperature for SWOT generation).

---

## 3. ExtractionAgent (`extraction_agent.py`)
**Purpose:** Scrapes structural fields, layout patterns, and core details (team, funding request, timeline milestones) to populate `ExtractedFormFields`.

**Strengths:**
- Integrated with `form_field_extractor.py` to identify Q&A blocks and tables.
- Feeds high-fidelity context to subsequent parameter agents, reducing redundant reading.

**Future Improvements:**
- Integrate visual chunk extraction (OCR coordinates) to extract diagram contexts.

---

## 4. ProblemRelevanceAgent (`problem_relevance_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 1**: How relevant is the startup's solution to critical agricultural challenges? Who are the target farmers, and does it address their primary pain points?

**Strengths:**
- Validates proposal claims against common regional farming obstacles.
- Specifically checks if target farmer descriptions are concrete or vague.

---

## 5. SolutionReadinessAgent (`solution_readiness_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 2**: Technological maturity (TRL 5-9), IP, novelty, and the technical innovation of the solution compared to legacy tools.

**Strengths:**
- Distinguishes between generic wrapper applications and core proprietary technology.
- Grades solution readiness using the formal Technology Readiness Level (TRL) matrix.

---

## 6. PilotDesignAgent (`pilot_design_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 3**: Pilot implementation plans, success metrics, timelines, milestones, and testing scope.

**Strengths:**
- Specifically flags unrealistic scheduling assumptions or missing milestones.
- Assesses the validity of success metrics (e.g., yield increase vs. app sign-ups).

---

## 7. FarmerAdoptionAgent (`farmer_adoption_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 4**: Usability, direct economic incentives for farmers, gender and youth inclusion, and potential social/cultural adoption barriers.

**Strengths:**
- Focuses heavily on the social inclusion metrics requested by challenge rubrics.
- Evaluates cost-effectiveness and economic incentives for smallholder farmers.

---

## 8. ScaleUpAgent (`scale_up_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 5**: Commercial viability, scale-up strategy, partner ecosystem, and financial sustainability models.

**Strengths:**
- Detects gaps in the business model, pricing structure, and financial planning.
- Evaluates dependency risks on grant funding vs. commercial revenue.

---

## 9. TeamCapacityAgent (`team_capacity_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 6**: Background, technical credentials, business experience, and agricultural extension expertise of the founding team.

**Strengths:**
- Maps individual team member profiles to their corresponding operational roles.
- Measures the balance between technical capability and business execution skill.

---

## 10. ComplianceAgent (`compliance_agent.py`)
**Purpose:** Evaluates **AIAIC Parameter 7**: Alignment with agricultural standards, environmental certifications, safety compliance, and local legal frameworks.

**Strengths:**
- Validates environmental safeguards and regulatory risk exposure.
- Scores compliance on a strict rubrics-aligned scale.

---

## 11. DebateAgent (`debate_agent.py`)
**Purpose:** Conducts a structured multi-agent cross-examination when scoring disputes or high-severity conflicts are identified in prior stages.

**Strengths:**
- Reconciles opposing arguments by evaluating the strength of literal text evidence.
- Outputs a transparent resolution log including score adjustments and remaining ambiguity points.

---

## 12. ScoringAgent (`scoring_agent.py`)
**Purpose:** Consolidates all parameter evaluations, processes the final mathematical scores, outputs the overarching SWOT analysis, and compiles recommendations.

**Strengths:**
- Builds a cohesive narrative by synthesizing insights from all 7 parameter evaluations.
- Translates numerical scores into semantic recommendations (e.g., "Highly Recommended").