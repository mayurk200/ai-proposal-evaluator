"""
Tests for app.services.processing.chunk_router — deterministic routing,
shared-context handling, ambiguity detection, LLM fallback, and orphan coverage.
"""

from app.models.enums import ChunkPosition, ChunkType
from app.services.processing import chunk_router
from app.services.processing.chunk_router import (
    COMPLIANCE,
    FARMER_ADOPTION,
    PARAMETER_AGENTS,
    PILOT_DESIGN,
    PROBLEM_RELEVANCE,
    SCALEUP,
    SOLUTION_READINESS,
    TEAM_CAPACITY,
    route_chunks,
)
from tests.conftest import make_chunk


def _chunk(text, section, *, idx, financial=False, technical=False,
           position=ChunkPosition.MIDDLE):
    return make_chunk(
        text=text,
        section_title=section,
        chunk_id=f"c{idx}",
        has_financial=financial,
        has_technical=technical,
        position=position,
    )


class StubLLM:
    """Records the fallback call and returns a canned assignment."""

    def __init__(self, assignments):
        self._assignments = assignments
        self.calls = 0

    def chat(self, **kwargs):
        self.calls += 1
        return {"result": {"assignments": self._assignments}, "tokens": 0}


# ============================================================================
# Deterministic routing
# ============================================================================


class TestDeterministicRouting:
    def test_finance_content_routes_to_scaleup(self):
        chunks = [
            _chunk("Company overview and mission.", "Introduction", idx=0,
                   position=ChunkPosition.START),
            _chunk("Team backgrounds and prior roles.", "Team", idx=1),
            _chunk(
                "Our revenue model is subscription based. Revenue in year one, "
                "revenue growth, unit economics and market traction with paying "
                "customers drive commercial sustainability.",
                "Revenue Model", idx=2, financial=True,
            ),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)

        # The finance-heavy chunk (index 2) must reach ScaleUp...
        assert 2 in result.table[SCALEUP]
        # ...and must NOT reach an unrelated agent like Compliance.
        assert 2 not in result.table[COMPLIANCE]

    def test_technical_content_routes_to_solution_readiness(self):
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk(
                "The technology stack uses a machine learning model at TRL 6. "
                "Our algorithm and deployment architecture are proprietary IP.",
                "Technology", idx=1, technical=True,
            ),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        assert 1 in result.table[SOLUTION_READINESS]

    def test_each_agent_key_present(self):
        chunks = [_chunk("x", "Introduction", idx=0, position=ChunkPosition.START)]
        result = route_chunks(chunks, enable_llm_fallback=False)
        for agent in PARAMETER_AGENTS:
            assert agent in result.table


# ============================================================================
# Shared context
# ============================================================================


class TestSharedContext:
    def test_first_chunks_are_shared_context(self):
        chunks = [
            _chunk("Identity and title.", "Introduction", idx=0,
                   position=ChunkPosition.START),
            _chunk("More intro.", "Overview", idx=1),
            _chunk("Pilot milestones and timeline schedule.", "Workplan", idx=2),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        assert result.shared_context_indices == [0, 1]

    def test_agent_chunk_indices_lead_with_shared_context(self):
        chunks = [
            _chunk("Identity.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("Identity 2.", "Overview", idx=1),
            _chunk("Pilot milestones and timeline and workplan schedule.",
                   "Workplan", idx=2),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        ordered = result.agent_chunk_indices(PILOT_DESIGN)
        assert ordered[:2] == [0, 1]
        assert 2 in ordered


# ============================================================================
# Orphan coverage
# ============================================================================


class TestOrphanCoverage:
    def test_signalless_chunk_goes_to_everyone(self):
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("zzzz qqqq wwww vvvv.", "Appendix", idx=1),  # no signal
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        # No chunk should be silently dropped: index 1 reaches at least one agent.
        reached = any(1 in idxs for idxs in result.table.values())
        assert reached
        assert result.diagnostics["orphan_chunks"] >= 1

    def test_no_orphans_when_signals_present(self):
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("Founder and team experience and credentials.", "Team", idx=1),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        assert 1 in result.table[TEAM_CAPACITY]
        assert result.diagnostics["orphan_chunks"] == 0


# ============================================================================
# LLM fallback
# ============================================================================


class TestLLMFallback:
    def test_ambiguous_chunk_escalates_and_uses_llm_assignment(self):
        # A vague chunk with weak signals -> ambiguous -> LLM decides.
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("This section discusses various considerations broadly.",
                   "Notes", idx=1),
        ]
        stub = StubLLM(assignments=[{"index": 1, "agents": [COMPLIANCE]}])
        result = route_chunks(chunks, enable_llm_fallback=True, llm_client=stub)

        assert stub.calls == 1
        assert 1 in result.table[COMPLIANCE]
        assert result.diagnostics["llm_fallback_used"] is True
        assert result.chunk_routings[1].routed_by_llm is True

    def test_llm_failure_falls_back_to_deterministic(self):
        class BoomLLM:
            def chat(self, **kwargs):
                raise RuntimeError("llm down")

        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("Vague broad considerations here.", "Notes", idx=1),
        ]
        # Must not raise; still produces a complete routing table.
        result = route_chunks(chunks, enable_llm_fallback=True, llm_client=BoomLLM())
        assert set(result.table.keys()) == set(PARAMETER_AGENTS)

    def test_invalid_agent_names_ignored(self):
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("Vague broad considerations.", "Notes", idx=1),
        ]
        stub = StubLLM(assignments=[{"index": 1, "agents": ["NotARealAgent"]}])
        result = route_chunks(chunks, enable_llm_fallback=True, llm_client=stub)
        # Invalid name dropped -> chunk still covered via argmax fallback.
        reached = any(1 in idxs for idxs in result.table.values())
        assert reached


# ============================================================================
# Diagnostics & edge cases
# ============================================================================


class TestDiagnostics:
    def test_empty_chunks(self):
        result = route_chunks([], enable_llm_fallback=False)
        assert result.table == {}
        assert result.diagnostics["total_chunks"] == 0

    def test_starved_agents_reported(self):
        chunks = [
            _chunk("Intro.", "Introduction", idx=0, position=ChunkPosition.START),
            _chunk("Revenue model market traction customers funding.",
                   "Revenue", idx=1, financial=True),
        ]
        result = route_chunks(chunks, enable_llm_fallback=False)
        # Only ScaleUp got a specific chunk; others should be flagged starved.
        assert SCALEUP not in result.diagnostics["starved_agents"]
        assert PROBLEM_RELEVANCE in result.diagnostics["starved_agents"]
