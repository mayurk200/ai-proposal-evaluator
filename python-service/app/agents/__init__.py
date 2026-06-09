"""
Agents package — Multi-agent AIAIC evaluation pipeline.

Each agent lives in its own sub-package for modularity.
Import agents from here for a clean public API.
"""

from app.agents.base_agent import BaseAgent
from app.agents.extraction import ExtractionAgent
from app.agents.problem_relevance import ProblemRelevanceAgent
from app.agents.solution_readiness import SolutionReadinessAgent
from app.agents.pilot_design import PilotDesignAgent
from app.agents.farmer_adoption import FarmerAdoptionAgent
from app.agents.scaleup import ScaleUpAgent
from app.agents.team_capacity import TeamCapacityAgent
from app.agents.compliance import ComplianceAgent
from app.agents.debate import DebateAgent
from app.agents.scoring import ScoringAgent
from app.agents.orchestrator import AgentOrchestrator

__all__ = [
    "BaseAgent",
    "ExtractionAgent",
    "ProblemRelevanceAgent",
    "SolutionReadinessAgent",
    "PilotDesignAgent",
    "FarmerAdoptionAgent",
    "ScaleUpAgent",
    "TeamCapacityAgent",
    "ComplianceAgent",
    "DebateAgent",
    "ScoringAgent",
    "AgentOrchestrator",
]
