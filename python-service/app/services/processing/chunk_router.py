"""
Chunk Router — Step 1 of the routed evaluation pipeline.

Classifies each document chunk ONCE and produces a routing table that maps every
parameter agent to the ranked list of chunks relevant to it. This is the core of
"the finance agent only receives finance-related content": instead of each agent
independently re-scanning all chunks with brittle substring matching (the old
``BaseAgent._filter_chunks_for_agent_new`` approach), routing is computed a single
time using weighted, word-boundary signals plus the metadata the chunker already
attaches (``chunk_type``, ``has_financial_data``, ``has_technical_content``,
``section_title``).

Routing is two-tier ("deterministic + LLM fallback"):

1. Deterministic scoring — fast, free, and covers the vast majority of chunks.
2. LLM fallback — only *ambiguous* chunks (weak or tied signals) are escalated to
   a single small LLM classification call. This keeps token load minimal while
   rescuing chunks that keyword scoring alone would misroute.

The router does NOT evaluate or score the proposal. It only decides *who reads
what*. Token-budgeted packing and dispatch to the agents happen in the
orchestrator (Step 2).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from app.utils.logging import get_logger

logger = get_logger(__name__)


# =============================================================================
# Agent identifiers — must match each parameter agent's ``name`` attribute.
# =============================================================================

PROBLEM_RELEVANCE = "ProblemRelevanceAgent"
SOLUTION_READINESS = "SolutionReadinessAgent"
PILOT_DESIGN = "PilotDesignAgent"
FARMER_ADOPTION = "FarmerAdoptionAgent"
SCALEUP = "ScaleUpAgent"
TEAM_CAPACITY = "TeamCapacityAgent"
COMPLIANCE = "ComplianceAgent"

PARAMETER_AGENTS: tuple[str, ...] = (
    PROBLEM_RELEVANCE,
    SOLUTION_READINESS,
    PILOT_DESIGN,
    FARMER_ADOPTION,
    SCALEUP,
    TEAM_CAPACITY,
    COMPLIANCE,
)


# =============================================================================
# Routing profiles — the vocabulary each agent "cares about".
#
# ``section_keywords`` match against a chunk's section_title (a strong signal —
# a section literally titled "Revenue Model" is almost certainly for ScaleUp).
# ``body_keywords`` match inside the chunk text (a weaker, cumulative signal).
# ``financial`` / ``technical`` mark agents that should be boosted when the
# chunker flagged a chunk as carrying financial or technical content.
# =============================================================================


@dataclass(frozen=True)
class AgentRoutingProfile:
    """Signals that make a chunk relevant to one agent."""

    agent: str
    section_keywords: tuple[str, ...]
    body_keywords: tuple[str, ...]
    financial: bool = False
    technical: bool = False


ROUTING_PROFILES: tuple[AgentRoutingProfile, ...] = (
    AgentRoutingProfile(
        agent=PROBLEM_RELEVANCE,
        section_keywords=(
            "problem", "problem statement", "introduction", "overview",
            "relevance", "application track", "strategic impact", "background",
        ),
        body_keywords=(
            "problem", "challenge", "pain point", "relevance", "farmer",
            "agriculture", "agri", "synopsis", "district", "need", "gap",
        ),
    ),
    AgentRoutingProfile(
        agent=SOLUTION_READINESS,
        section_keywords=(
            "solution", "proposed solution", "technology", "technical",
            "architecture", "tech stack", "innovation", "trl level",
            "intellectual property", "data sources used",
            "open-source technologies", "unique value proposition",
        ),
        body_keywords=(
            "solution", "technology", "trl", "innovation", "patent", "ip ",
            "readiness", "technical", "stack", "dataset", "model", "algorithm",
            "prototype", "deployment",
        ),
        technical=True,
    ),
    AgentRoutingProfile(
        agent=PILOT_DESIGN,
        section_keywords=(
            "pilot", "workplan", "workplan & milestones", "milestones",
            "timeline", "risk assessment", "risk assessment & mitigation",
            "training & capacity-building", "expected outputs", "output expected",
            "proposed project duration", "total project cost", "baseline values",
            "proposed project districts",
        ),
        body_keywords=(
            "pilot", "milestone", "workplan", "timeline", "schedule",
            "implementation", "duration", "deliverable", "risk", "mitigation",
            "baseline", "rollout", "phase",
        ),
    ),
    AgentRoutingProfile(
        agent=FARMER_ADOPTION,
        section_keywords=(
            "farmer-centric benefits", "farmer centric benefits",
            "pricing strategy", "gender and social inclusion",
            "social inclusion plan", "training & capacity-building",
            "adoption", "beneficiaries",
        ),
        body_keywords=(
            "farmer", "adoption", "gender", "youth", "inclusion", "pricing",
            "affordab", "benefit", "training", "capacity", "uptake",
            "beneficiar", "smallholder",
        ),
    ),
    AgentRoutingProfile(
        agent=SCALEUP,
        section_keywords=(
            "revenue", "revenue model", "business model", "financial",
            "financials", "budget", "funding", "market", "market analysis",
            "go-to-market strategy", "traction", "current customers/pilots",
            "current customers", "scalability", "growth", "sustainability",
            "prior govt. collaboration",
        ),
        body_keywords=(
            "scale", "revenue", "financial", "budget", "business model",
            "commercial", "market", "pricing", "customer", "traction",
            "unit economics", "funding", "investment", "pipeline", "margin",
            "monetization", "arr", "mrr",
        ),
        financial=True,
    ),
    AgentRoutingProfile(
        agent=TEAM_CAPACITY,
        section_keywords=(
            "team", "founders", "leadership", "management",
            "core team and leadership", "founders background",
        ),
        body_keywords=(
            "team", "founder", "co-founder", "leadership", "experience",
            "qualification", "capacity", "credentials", "resume", "cv",
            "expertise", "advisor", "hire",
        ),
    ),
    AgentRoutingProfile(
        agent=COMPLIANCE,
        section_keywords=(
            "compliance", "regulatory", "governance", "legal",
            "dpdp act", "data governance", "model safety",
        ),
        body_keywords=(
            "compliance", "standard", "safety", "dpdp", "regulation", "legal",
            "certification", "ethics", "privacy", "consent", "governance",
            "audit",
        ),
    ),
)

_PROFILE_BY_AGENT: dict[str, AgentRoutingProfile] = {p.agent: p for p in ROUTING_PROFILES}


# =============================================================================
# Scoring weights and thresholds.
# =============================================================================

SECTION_TITLE_WEIGHT = 3.0      # per distinct section keyword found in the title
BODY_KEYWORD_WEIGHT = 1.0       # per distinct body keyword found in the text
BODY_KEYWORD_REPEAT_BONUS = 0.5  # extra, per keyword that appears >= 3 times
METADATA_FLAG_WEIGHT = 2.0      # financial/technical metadata alignment

# A chunk is assigned to any agent scoring at or above this.
ASSIGN_THRESHOLD = 1.0

# Ambiguity: escalate to the LLM when the best signal is weak, or when the top
# two agents are within TIE_MARGIN of each other and neither is a strong match.
AMBIGUITY_MIN_SCORE = 2.0
TIE_MARGIN = 1.0
STRONG_SCORE = 5.0

# Cap on how many ambiguous chunks we send to the LLM fallback in one document,
# to keep token load bounded on pathological inputs.
MAX_LLM_FALLBACK_CHUNKS = 24
LLM_FALLBACK_CHARS_PER_CHUNK = 600


# =============================================================================
# Result data structures.
# =============================================================================


@dataclass
class ChunkRouting:
    """How a single chunk was routed."""

    chunk_id: str
    index: int
    section_title: str
    scores: dict[str, float] = field(default_factory=dict)  # agent -> score
    assigned_agents: list[str] = field(default_factory=list)
    is_shared_context: bool = False
    was_ambiguous: bool = False
    routed_by_llm: bool = False
    routing_source: str = "deterministic"  # deterministic | llm | argmax-fallback | shared


@dataclass
class RoutingResult:
    """
    The complete routing decision for one document.

    ``table`` maps agent -> ordered list of chunk indices (best match first).
    ``shared_context_indices`` are intro/identity chunks handed to every agent.
    ``diagnostics`` powers the human-like monitoring layer (Step 5).
    """

    table: dict[str, list[int]] = field(default_factory=dict)
    shared_context_indices: list[int] = field(default_factory=list)
    chunk_routings: list[ChunkRouting] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def agent_chunk_indices(self, agent: str) -> list[int]:
        """Indices routed to ``agent``, shared-context chunks first, then ranked matches."""
        specific = self.table.get(agent, [])
        # Shared context leads (intro/identity), then specific matches, de-duplicated.
        ordered: list[int] = []
        seen: set[int] = set()
        for idx in self.shared_context_indices + specific:
            if idx not in seen:
                seen.add(idx)
                ordered.append(idx)
        return ordered


# =============================================================================
# Deterministic scoring.
# =============================================================================


def _compiled_keyword(keyword: str) -> re.Pattern[str]:
    """Word-boundary matcher for a keyword/phrase (case-insensitive)."""
    # Escape, and allow flexible whitespace between words in multi-word phrases.
    parts = [re.escape(p) for p in keyword.split()]
    pattern = r"\b" + r"\s+".join(parts) + r"\b"
    return re.compile(pattern, re.IGNORECASE)


# Pre-compile every keyword pattern once at import time.
_SECTION_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    p.agent: [_compiled_keyword(k) for k in p.section_keywords] for p in ROUTING_PROFILES
}
_BODY_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    p.agent: [_compiled_keyword(k) for k in p.body_keywords] for p in ROUTING_PROFILES
}


def _score_chunk_for_agent(
    profile: AgentRoutingProfile,
    section_title: str,
    text: str,
    has_financial: bool,
    has_technical: bool,
) -> float:
    """Deterministic relevance score of one chunk for one agent."""
    score = 0.0

    section_lower = section_title or ""
    for pat in _SECTION_PATTERNS[profile.agent]:
        if pat.search(section_lower):
            score += SECTION_TITLE_WEIGHT

    for pat in _BODY_PATTERNS[profile.agent]:
        matches = pat.findall(text)
        if matches:
            score += BODY_KEYWORD_WEIGHT
            if len(matches) >= 3:
                score += BODY_KEYWORD_REPEAT_BONUS

    if profile.financial and has_financial:
        score += METADATA_FLAG_WEIGHT
    if profile.technical and has_technical:
        score += METADATA_FLAG_WEIGHT

    return round(score, 3)


# Section titles that mark a chunk as document-wide identity/context worth
# handing to every agent (kept deliberately small so it never swallows
# substantive, agent-specific sections).
INTRO_SECTION_KEYWORDS: tuple[str, ...] = (
    "introduction",
    "overview",
    "executive summary",
    "about the applicant",
    "applicant details",
    "background",
)

_INTRO_SECTION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    _compiled_keyword(k) for k in INTRO_SECTION_KEYWORDS
)


def _is_intro_context(index: int, chunk: Any) -> bool:
    """
    Shared identity/context: the very first chunk (title/applicant page), any
    START-position chunk, or a chunk whose section title is intro-like. Kept
    minimal so agent-specific sections are never absorbed into shared context.
    """
    if index == 0:
        return True
    position = getattr(chunk, "position", None)
    position_value = getattr(position, "value", position)
    if str(position_value).lower() == "start":
        return True
    section = getattr(chunk, "section_title", "") or ""
    return any(pat.search(section) for pat in _INTRO_SECTION_PATTERNS)


def _is_ambiguous(scores: dict[str, float]) -> bool:
    """A chunk is ambiguous when no agent clearly owns it."""
    if not scores:
        return True
    ranked = sorted(scores.values(), reverse=True)
    best = ranked[0]
    if best < AMBIGUITY_MIN_SCORE:
        return True
    second = ranked[1] if len(ranked) > 1 else 0.0
    if best < STRONG_SCORE and (best - second) < TIE_MARGIN:
        return True
    return False


# =============================================================================
# Public entry point.
# =============================================================================


def route_chunks(
    chunks: list[Any],
    *,
    enable_llm_fallback: bool = True,
    llm_client: Optional[Any] = None,
) -> RoutingResult:
    """
    Route document chunks to parameter agents.

    Args:
        chunks: DocumentChunk objects (need ``chunk_id``, ``text``,
            ``section_title``, ``has_financial_data``, ``has_technical_content``,
            ``position``).
        enable_llm_fallback: When True, ambiguous chunks are escalated to a small
            LLM classification call. When False, routing is purely deterministic.
        llm_client: Optional LLM client (defaults to the shared singleton). Only
            used when there are ambiguous chunks and the fallback is enabled.

    Returns:
        RoutingResult with the per-agent routing table, shared context, and
        diagnostics for monitoring.
    """
    result = RoutingResult()
    if not chunks:
        result.diagnostics = _empty_diagnostics()
        return result

    routings: list[ChunkRouting] = []
    ambiguous_indices: list[int] = []

    # ---- Tier 1: deterministic scoring ----
    for index, chunk in enumerate(chunks):
        text = getattr(chunk, "text", "") or ""
        section_title = getattr(chunk, "section_title", "") or ""
        has_financial = bool(getattr(chunk, "has_financial_data", False))
        has_technical = bool(getattr(chunk, "has_technical_content", False))

        scores = {
            profile.agent: _score_chunk_for_agent(
                profile, section_title, text, has_financial, has_technical
            )
            for profile in ROUTING_PROFILES
        }

        routing = ChunkRouting(
            chunk_id=getattr(chunk, "chunk_id", str(index)),
            index=index,
            section_title=section_title,
            scores=scores,
        )

        if _is_intro_context(index, chunk):
            routing.is_shared_context = True
            routing.routing_source = "shared"
            result.shared_context_indices.append(index)

        # Assign every agent scoring above threshold.
        routing.assigned_agents = [
            agent for agent, s in scores.items() if s >= ASSIGN_THRESHOLD
        ]

        if not routing.is_shared_context and _is_ambiguous(scores):
            routing.was_ambiguous = True
            ambiguous_indices.append(index)

        routings.append(routing)

    # ---- Tier 2: LLM fallback for ambiguous chunks ----
    llm_used = False
    llm_resolved = 0
    if enable_llm_fallback and ambiguous_indices:
        llm_used, llm_resolved = _apply_llm_fallback(
            chunks, routings, ambiguous_indices, llm_client
        )

    # ---- Guarantee coverage: no orphan chunks ----
    orphan_count = 0
    for routing in routings:
        if routing.is_shared_context:
            continue
        if routing.assigned_agents:
            continue
        # Argmax fallback: give the chunk to its single best-scoring agent so no
        # content is silently dropped.
        best_agent = max(routing.scores, key=routing.scores.get) if routing.scores else None
        if best_agent and routing.scores[best_agent] > 0:
            routing.assigned_agents = [best_agent]
            routing.routing_source = "argmax-fallback"
        else:
            # Truly signal-less chunk — expose it to everyone as low-priority context.
            routing.assigned_agents = list(PARAMETER_AGENTS)
            routing.routing_source = "argmax-fallback"
        orphan_count += 1

    # ---- Build the routing table (ranked per agent) ----
    table: dict[str, list[tuple[int, float]]] = {agent: [] for agent in PARAMETER_AGENTS}
    for routing in routings:
        if routing.is_shared_context:
            continue
        for agent in routing.assigned_agents:
            score = routing.scores.get(agent, 0.0)
            table[agent].append((routing.index, score))

    result.table = {
        agent: [idx for idx, _ in sorted(pairs, key=lambda p: p[1], reverse=True)]
        for agent, pairs in table.items()
    }
    result.chunk_routings = routings
    result.diagnostics = _build_diagnostics(
        routings=routings,
        table=result.table,
        shared=result.shared_context_indices,
        total_chunks=len(chunks),
        ambiguous=len(ambiguous_indices),
        llm_used=llm_used,
        llm_resolved=llm_resolved,
        orphan_count=orphan_count,
    )

    logger.info(
        "chunks_routed",
        total_chunks=len(chunks),
        shared_context=len(result.shared_context_indices),
        ambiguous=len(ambiguous_indices),
        llm_used=llm_used,
        orphans=orphan_count,
        per_agent={a: len(idxs) for a, idxs in result.table.items()},
    )

    return result


# =============================================================================
# LLM fallback classifier.
# =============================================================================

_LLM_FALLBACK_SYSTEM_PROMPT = (
    "You route sections of an agriculture startup proposal to the specialist "
    "reviewers who should read them. For each numbered excerpt, list the reviewers "
    "whose evaluation depends on that content. Choose ONLY from this exact set of "
    "reviewer ids:\n"
    f"{', '.join(PARAMETER_AGENTS)}\n\n"
    "Guidance:\n"
    "- ProblemRelevanceAgent: the problem, its relevance to farmers/agriculture.\n"
    "- SolutionReadinessAgent: the technology, TRL, IP, technical maturity.\n"
    "- PilotDesignAgent: pilot plan, milestones, timeline, budget, risks.\n"
    "- FarmerAdoptionAgent: farmer benefits, pricing/affordability, inclusion, training.\n"
    "- ScaleUpAgent: revenue/business model, market, traction, financial sustainability.\n"
    "- TeamCapacityAgent: founders, team, experience, credentials.\n"
    "- ComplianceAgent: data governance, DPDP/privacy, model safety, regulation.\n\n"
    "A single excerpt may go to multiple reviewers. Assign at least one. "
    'Return ONLY JSON: {"assignments": [{"index": <int>, "agents": ["<id>", ...]}]}'
)


def _apply_llm_fallback(
    chunks: list[Any],
    routings: list[ChunkRouting],
    ambiguous_indices: list[int],
    llm_client: Optional[Any],
) -> tuple[bool, int]:
    """
    Escalate ambiguous chunks to a single LLM classification call.

    Mutates ``routings`` in place, adding LLM-assigned agents. Returns
    ``(llm_used, resolved_count)``. Never raises — routing must survive an LLM
    outage and fall back to deterministic assignment.
    """
    targets = ambiguous_indices[:MAX_LLM_FALLBACK_CHUNKS]
    if not targets:
        return False, 0

    try:
        client = llm_client
        if client is None:
            from app.services.llm.llm_client import get_llm_client

            client = get_llm_client()

        user_content = _build_fallback_prompt(chunks, targets)
        response = client.chat(
            system_prompt=_LLM_FALLBACK_SYSTEM_PROMPT,
            user_content=user_content,
            temperature=0.0,
            max_tokens=1024,
        )
    except Exception as exc:  # noqa: BLE001 — routing must not fail on LLM error
        logger.warning("chunk_router_llm_fallback_failed", error=str(exc))
        return False, 0

    assignments = _parse_fallback_response(response.get("result", {}))
    if not assignments:
        return True, 0

    valid_agents = set(PARAMETER_AGENTS)
    resolved = 0
    for index, agents in assignments.items():
        if index < 0 or index >= len(routings):
            continue
        clean = [a for a in agents if a in valid_agents]
        if not clean:
            continue
        routing = routings[index]
        merged = list(dict.fromkeys(routing.assigned_agents + clean))
        routing.assigned_agents = merged
        routing.routed_by_llm = True
        routing.routing_source = "llm"
        resolved += 1

    return True, resolved


def _build_fallback_prompt(chunks: list[Any], targets: list[int]) -> str:
    """Compact, truncated excerpts for the ambiguous chunks only."""
    parts = ["Route these excerpts:\n"]
    for index in targets:
        chunk = chunks[index]
        section = getattr(chunk, "section_title", "") or "(untitled)"
        text = (getattr(chunk, "text", "") or "")[:LLM_FALLBACK_CHARS_PER_CHUNK]
        parts.append(f"[{index}] Section: {section}\n{text}\n")
    return "\n".join(parts)


def _parse_fallback_response(result: dict) -> dict[int, list[str]]:
    """Coerce the LLM's assignment JSON into ``{index: [agent, ...]}``."""
    if not isinstance(result, dict):
        return {}
    raw = result.get("assignments")
    if not isinstance(raw, list):
        return {}

    out: dict[int, list[str]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        agents = item.get("agents")
        if isinstance(agents, str):
            agents = [agents]
        if not isinstance(agents, list):
            continue
        out[index] = [str(a).strip() for a in agents if str(a).strip()]
    return out


# =============================================================================
# Diagnostics (feeds the monitoring layer).
# =============================================================================


def _empty_diagnostics() -> dict[str, Any]:
    return {
        "total_chunks": 0,
        "shared_context_chunks": 0,
        "ambiguous_chunks": 0,
        "llm_fallback_used": False,
        "llm_resolved_chunks": 0,
        "orphan_chunks": 0,
        "per_agent_chunk_count": {agent: 0 for agent in PARAMETER_AGENTS},
        "starved_agents": list(PARAMETER_AGENTS),
    }


def _build_diagnostics(
    *,
    routings: list[ChunkRouting],
    table: dict[str, list[int]],
    shared: list[int],
    total_chunks: int,
    ambiguous: int,
    llm_used: bool,
    llm_resolved: int,
    orphan_count: int,
) -> dict[str, Any]:
    per_agent = {agent: len(table.get(agent, [])) for agent in PARAMETER_AGENTS}
    # An agent is "starved" if it received no specific chunks — only shared
    # context. The supervisor (Step 5) turns this into an "insufficient
    # evidence" signal rather than a fabricated low score.
    starved = [agent for agent, count in per_agent.items() if count == 0]
    return {
        "total_chunks": total_chunks,
        "shared_context_chunks": len(shared),
        "ambiguous_chunks": ambiguous,
        "llm_fallback_used": llm_used,
        "llm_resolved_chunks": llm_resolved,
        "orphan_chunks": orphan_count,
        "per_agent_chunk_count": per_agent,
        "starved_agents": starved,
    }
