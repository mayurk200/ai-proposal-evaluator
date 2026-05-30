"""
Agent output validation layer.

Provides Pydantic-based strict validation for all LLM agent outputs.
Key design: NEVER raises — always returns a usable (possibly degraded) result
plus a list of warnings for logging.
"""

from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.schemas import EvidenceItem
from app.utils.logging import get_logger

logger = get_logger(__name__)


# =============================================================================
# Score Utilities
# =============================================================================


def clamp_score(value: Any, min_val: float = 0.0, max_val: float = 100.0) -> float:
    """
    Safely coerce and clamp a score value to [min_val, max_val].

    Handles: int, float, str("75"), None, bool, and garbage values.
    """
    if value is None:
        return 0.0
    try:
        score = float(value)
    except (ValueError, TypeError):
        return 0.0
    if score != score:  # NaN check
        return 0.0
    return max(min_val, min(max_val, score))


def clamp_confidence(value: Any) -> float:
    """Safely coerce and clamp a confidence value to [0.0, 1.0]."""
    return clamp_score(value, 0.0, 1.0)


# =============================================================================
# Validation Schemas
# =============================================================================


class AgentOutputSchema(BaseModel):
    """
    Schema enforcing the standard analysis agent output contract.
    Every field has a safe default so partial LLM output never crashes.
    """
    score: float = Field(default=0.0)
    confidence: float = Field(default=0.0)
    analysis: str = ""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    risk_factors: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)

    @field_validator("score", mode="before")
    @classmethod
    def validate_score(cls, v: Any) -> float:
        return clamp_score(v)

    @field_validator("confidence", mode="before")
    @classmethod
    def validate_confidence(cls, v: Any) -> float:
        return clamp_confidence(v)

    @field_validator("analysis", mode="before")
    @classmethod
    def validate_analysis(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v)

    @field_validator(
        "strengths", "weaknesses", "risk_factors", "improvement_suggestions",
        "key_findings", "red_flags", "recommendations", "missing_information",
        mode="before",
    )
    @classmethod
    def validate_string_list(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [v] if v.strip() else []
        if isinstance(v, list):
            return [str(item) for item in v if item is not None]
        return []

    @field_validator("evidence", mode="before")
    @classmethod
    def validate_evidence(cls, v: Any) -> list[dict]:
        if v is None:
            return []
        if isinstance(v, list):
            result = []
            for item in v:
                if isinstance(item, dict):
                    result.append({
                        "claim": str(item.get("claim", "")),
                        "source": str(item.get("source", "")),
                        "text": str(item.get("text", "")),
                    })
                elif isinstance(item, str):
                    result.append({"claim": item, "source": "", "text": ""})
            return result
        return []


class ExtractionOutputSchema(BaseModel):
    """Schema for the extraction agent's structured output."""
    score: float = Field(default=0.0)
    startup_name: str = "Not specified"
    founders: list[dict] = Field(default_factory=list)
    problem_statement: str = "Not specified"
    proposed_solution: str = "Not specified"
    target_market: str = "Not specified"
    industry_sector: str = "Not specified"
    business_model: str = "Not specified"
    revenue_streams: list[str] = Field(default_factory=list)
    funding_requirements: str = "Not specified"
    current_traction: str = "Not specified"
    technology_used: list[str] = Field(default_factory=list)
    sustainability_approach: str = "Not specified"
    competitive_advantages: list[str] = Field(default_factory=list)
    key_metrics: list[str] = Field(default_factory=list)
    timeline: list[str] = Field(default_factory=list)
    team_size: str = "Not specified"
    geographic_focus: str = "Not specified"
    partnerships: list[str] = Field(default_factory=list)
    unclear_claims: list[str] = Field(default_factory=list)
    missing_critical_info: list[str] = Field(default_factory=list)
    analysis: str = ""
    key_findings: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0)

    @field_validator("score", mode="before")
    @classmethod
    def validate_score(cls, v: Any) -> float:
        return clamp_score(v)

    @field_validator("confidence", mode="before")
    @classmethod
    def validate_confidence(cls, v: Any) -> float:
        return clamp_confidence(v)


# =============================================================================
# Validation Entry Point
# =============================================================================


def validate_agent_output(
    raw: dict[str, Any],
    schema: type[BaseModel] = AgentOutputSchema,
    agent_name: str = "unknown",
) -> tuple[dict[str, Any], list[str]]:
    """
    Validate and sanitize an agent's raw LLM output against a schema.

    Returns:
        (validated_dict, warnings) — always usable, never raises.
    """
    warnings: list[str] = []

    if not isinstance(raw, dict):
        warnings.append(f"[{agent_name}] Expected dict, got {type(raw).__name__}. Using defaults.")
        try:
            validated = schema()
            return validated.model_dump(), warnings
        except Exception:
            return {}, warnings

    try:
        validated = schema.model_validate(raw)
        return validated.model_dump(), warnings
    except Exception as e:
        warnings.append(f"[{agent_name}] Validation failed: {str(e)[:200]}. Attempting partial recovery.")

    # Partial recovery: validate field by field
    recovered: dict[str, Any] = {}
    schema_fields = schema.model_fields

    for field_name, field_info in schema_fields.items():
        if field_name in raw:
            recovered[field_name] = raw[field_name]
        elif field_info.default is not None:
            recovered[field_name] = field_info.default
        elif field_info.default_factory is not None:
            recovered[field_name] = field_info.default_factory()

    try:
        validated = schema.model_validate(recovered)
        return validated.model_dump(), warnings
    except Exception as e2:
        warnings.append(f"[{agent_name}] Partial recovery also failed: {str(e2)[:200]}. Using bare defaults.")
        try:
            default_obj = schema()
            return default_obj.model_dump(), warnings
        except Exception:
            return {}, warnings


def parse_evidence_items(raw_evidence: list[dict]) -> list[EvidenceItem]:
    """Convert raw evidence dicts to EvidenceItem models."""
    items: list[EvidenceItem] = []
    for entry in raw_evidence:
        if isinstance(entry, dict):
            try:
                items.append(EvidenceItem(
                    claim=str(entry.get("claim", "")),
                    source=str(entry.get("source", "")),
                    text=str(entry.get("text", "")),
                ))
            except Exception:
                continue
    return items
