"""
Agents — the AIAIC evaluation pipeline.

  metadata_agent  runs once at ingestion, on the fast model, to derive the idea's
                  identity (company, category, problem, solution).
  parameters      the seven AIAIC parameter agents. Section-routed; every score must
                  carry a verbatim citation or be declared unevidenced.
  debate_agent    runs only when the parameter assessments contradict each other.
  scoring_agent   blind synthesis — sees scores and citations, never the company name
                  or the raw document.
  orchestrator    routes sections, runs the seven in parallel, then debate, then
                  synthesis.

The old ExtractionAgent is gone: it spent a full LLM call per evaluation pulling out
structured fields that the metadata agent now derives once, at ingestion, on the cheap
model, and persists.
"""

from app.agents.base_agent import BaseAgent
from app.agents.debate_agent import DebateAgent, debate_agent
from app.agents.metadata.metadata_agent import MetadataAgent, metadata_agent
from app.agents.orchestrator import AgentOrchestrator, orchestrator
from app.agents.parameters import (
    PARAMETER_AGENTS,
    PARAMETER_LABELS,
    WEIGHTS,
    ComplianceAgent,
    FarmerAdoptionAgent,
    PilotDesignAgent,
    ProblemRelevanceAgent,
    ScaleUpAgent,
    SolutionReadinessAgent,
    TeamCapacityAgent,
)
from app.agents.scoring_agent import ScoringAgent, scoring_agent

__all__ = [
    "PARAMETER_AGENTS",
    "PARAMETER_LABELS",
    "WEIGHTS",
    "AgentOrchestrator",
    "BaseAgent",
    "ComplianceAgent",
    "DebateAgent",
    "FarmerAdoptionAgent",
    "MetadataAgent",
    "PilotDesignAgent",
    "ProblemRelevanceAgent",
    "ScaleUpAgent",
    "ScoringAgent",
    "SolutionReadinessAgent",
    "TeamCapacityAgent",
    "debate_agent",
    "metadata_agent",
    "orchestrator",
    "scoring_agent",
]
