"""
Agent orchestrator — coordinates the AIAIC evaluation pipeline.

Pipeline:
1. ExtractionAgent — Structured data extraction from proposal
2. 7 Parameter Agents — Sequential evaluation of AIAIC parameters
3. DebateAgent — Cross-agent conflict detection and resolution
4. FinalScoringAgent — Weighted synthesis with debate adjustments
"""

import time

from app.models.schemas import (
    AgentResult,
    DocumentMetadata,
    EvaluationResponse,
    FinalEvaluation,
    ProcessedDocument,
)
from app.models.enums import ProcessingStatus
from app.agents.extraction.extraction_agent import ExtractionAgent
from app.agents.problem_relevance.problem_relevance_agent import ProblemRelevanceAgent
from app.agents.solution_readiness.solution_readiness_agent import SolutionReadinessAgent
from app.agents.pilot_design.pilot_design_agent import PilotDesignAgent
from app.agents.farmer_adoption.farmer_adoption_agent import FarmerAdoptionAgent
from app.agents.scaleup.scaleup_agent import ScaleUpAgent
from app.agents.team_capacity.team_capacity_agent import TeamCapacityAgent
from app.agents.compliance.compliance_agent import ComplianceAgent
from app.agents.debate.debate_agent import DebateAgent
from app.agents.scoring.scoring_agent import ScoringAgent
from app.utils.logging import get_logger

logger = get_logger(__name__)


class AgentOrchestrator:
    """
    Orchestrates the multi-agent AIAIC evaluation pipeline.

    Coordinates extraction, 7 parameter evaluations, debate analysis,
    and final scoring in a sequential pipeline with form field awareness.
    """

    def __init__(self):
        # Extraction
        self.extraction_agent = ExtractionAgent()

        # Parameter agents (ordered by evaluation parameter number)
        self.parameter_agents = [
            ProblemRelevanceAgent(),
            SolutionReadinessAgent(),
            PilotDesignAgent(),
            FarmerAdoptionAgent(),
            ScaleUpAgent(),
            TeamCapacityAgent(),
            ComplianceAgent(),
        ]

        # Meta-agents
        self.debate_agent = DebateAgent()
        self.scoring_agent = ScoringAgent()

    async def evaluate(
        self,
        document: ProcessedDocument,
    ) -> EvaluationResponse:
        """
        Run the full AIAIC evaluation pipeline on a processed document.

        Args:
            document: Processed document with text, chunks, and form fields.

        Returns:
            EvaluationResponse with all agent results and final evaluation.
        """
        start_time = time.time()

        logger.info(
            "evaluation_started",
            filename=document.metadata.filename,
            chunks=len(document.chunks),
            form_fields=document.form_fields.qa_pairs_count if document.form_fields else 0,
        )

        # Prepare content for agents
        content = self._prepare_content(document)
        metadata_dict = self._metadata_to_dict(document.metadata)
        form_fields_dict = (
            document.form_fields.model_dump() if document.form_fields else None
        )

        agent_results: dict[str, AgentResult] = {}

        # =================================================================
        # Step 1: Extraction Agent
        # =================================================================
        logger.info("running_agent", agent="ExtractionAgent", step="1/10")
        extraction_result = await self.extraction_agent.analyze(
            content=content,
            metadata=metadata_dict,
            form_fields=form_fields_dict,
            chunks=document.chunks,
        )
        agent_results["ExtractionAgent"] = extraction_result

        # Merge extraction agent's structured data with form fields
        extracted_data = extraction_result.raw_output.get("extracted_data", {})
        if form_fields_dict and extracted_data:
            # Enrich form fields with LLM-extracted data
            enriched_fields = {**(form_fields_dict.get("fields", {})), **extracted_data}
            form_fields_dict = {**form_fields_dict, "fields": enriched_fields}

        # =================================================================
        # Step 2: Parameter Agents (sequential)
        # =================================================================
        parameter_results: dict[str, AgentResult] = {}

        for i, agent in enumerate(self.parameter_agents, 2):
            logger.info("running_agent", agent=agent.name, step=f"{i}/10")
            try:
                result = await agent.analyze(
                    content=content,
                    metadata=metadata_dict,
                    form_fields=form_fields_dict,
                    chunks=document.chunks,
                )
                parameter_results[agent.name] = result
                agent_results[agent.name] = result

                logger.info(
                    "agent_result",
                    agent=agent.name,
                    score=result.score,
                    sub_questions=len(result.sub_questions),
                    status=result.status,
                )

            except Exception as e:
                logger.error("agent_error", agent=agent.name, error=str(e))
                error_result = AgentResult(
                    agent_name=agent.name,
                    score=0.0,
                    analysis=f"Agent failed: {str(e)}",
                    status="failed",
                    error=str(e),
                )
                parameter_results[agent.name] = error_result
                agent_results[agent.name] = error_result

        # =================================================================
        # Step 3: Debate Agent
        # =================================================================
        debate_result = None
        if self.debate_agent.should_trigger(parameter_results):
            logger.info("running_agent", agent="DebateAgent", step="9/10")
            try:
                debate_result = await self.debate_agent.analyze(
                    agent_results=parameter_results,
                    proposal_summary=document.summary,
                )
                agent_results["DebateAgent"] = debate_result
                logger.info(
                    "debate_result",
                    conflicts=len(debate_result.raw_output.get("conflicts_found", [])),
                    adjustments=len(debate_result.raw_output.get("debates", [])),
                )
            except Exception as e:
                logger.error("debate_error", error=str(e))
        else:
            logger.info("debate_skipped", reason="trigger conditions not met")

        # =================================================================
        # Step 4: Final Scoring
        # =================================================================
        logger.info("running_agent", agent="FinalScoringAgent", step="10/10")
        try:
            final_evaluation = await self.scoring_agent.synthesize(
                agent_results=parameter_results,
                debate_result=debate_result,
                proposal_summary=document.summary,
            )
        except Exception as e:
            logger.error("scoring_error", error=str(e))
            final_evaluation = FinalEvaluation(
                overall_score=0.0,
                summary=f"Scoring failed: {str(e)}",
                recommendation="Not Recommended",
            )

        processing_time = time.time() - start_time

        logger.info(
            "evaluation_completed",
            overall_score=final_evaluation.overall_score,
            recommendation=final_evaluation.recommendation,
            agents_completed=sum(1 for r in agent_results.values() if r.status == "success"),
            processing_seconds=round(processing_time, 2),
        )

        return EvaluationResponse(
            status="success",
            processing_status=ProcessingStatus.COMPLETED,
            document_metadata=document.metadata,
            evaluation=final_evaluation,
            agent_results=agent_results,
            processing_time_seconds=round(processing_time, 2),
        )

    def _prepare_content(self, document: ProcessedDocument) -> str:
        """Prepare the content string from document chunks and summary."""
        parts = []

        # Add executive summary if available
        if document.summary:
            parts.append(f"=== EXECUTIVE SUMMARY ===\n{document.summary}\n")

        # Add chunk content
        if document.chunks:
            parts.append("=== DOCUMENT CONTENT ===\n")
            for chunk in document.chunks:
                header = f"[Section: {chunk.section_title}]"
                if chunk.page_numbers:
                    header += f" [Pages: {', '.join(str(p) for p in chunk.page_numbers)}]"
                parts.append(f"{header}\n{chunk.text}\n")
        elif document.full_text:
            parts.append(f"=== FULL TEXT ===\n{document.full_text[:15000]}\n")

        return "\n".join(parts)

    def _metadata_to_dict(self, metadata: DocumentMetadata) -> dict:
        """Convert metadata to dict for agent consumption."""
        return {
            "filename": metadata.filename,
            "format": metadata.format,
            "total_pages": metadata.total_pages,
            "total_words": metadata.total_words,
            "total_chunks": metadata.total_chunks,
            "total_tables": metadata.total_tables,
            "total_images": metadata.total_images,
            "detected_sections": metadata.detected_sections,
        }


# Singleton for use in routes
orchestrator = AgentOrchestrator()
