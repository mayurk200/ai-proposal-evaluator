"""
LLM-based summarization service.
Generates concise summaries of document chunks to fit within LLM context windows
while preserving key information for evaluation agents.
"""

from typing import Optional

from app.models.schemas import DocumentChunk
from app.services.llm_client import get_llm_client
from app.utils.logging import get_logger
from app.utils.text_cleaning import estimate_token_count

logger = get_logger(__name__)

SUMMARIZE_SYSTEM_PROMPT = """You are an expert document analyst. Your task is to create a comprehensive summary of the provided text from a startup/vendor proposal.

Your summary MUST:
1. Preserve ALL key facts, numbers, metrics, and claims
2. Maintain the structure of the argument
3. Keep all financial figures, market sizes, and quantitative data EXACTLY as stated
4. Preserve team credentials and experience details
5. Keep technology stack and architecture details
6. Note any risks, challenges, or limitations mentioned
7. Flag any vague or unsubstantiated claims

Write in clear, dense prose. Do NOT add your own analysis or opinions.
Do NOT invent information not present in the source text.

Return your response as a JSON object:
{
    "summary": "The comprehensive summary text",
    "key_points": ["point1", "point2", ...],
    "financial_highlights": ["highlight1", "highlight2", ...],
    "technical_highlights": ["highlight1", "highlight2", ...],
    "claims_to_verify": ["claim1", "claim2", ...],
    "missing_information": ["info1", "info2", ...]
}"""

COMBINE_SUMMARIES_PROMPT = """You are an expert document analyst. You will be given multiple chunk summaries from different sections of a startup/vendor proposal document. Your task is to combine them into ONE unified executive summary.

Rules:
1. Merge overlapping information (some chunks overlap for context)
2. Preserve ALL unique facts, numbers, and claims
3. Organize logically: Problem → Solution → Market → Financials → Team → Technology → Risks
4. Keep it comprehensive but non-redundant
5. Do NOT add your own analysis

Return your response as a JSON object:
{
    "executive_summary": "The unified summary text",
    "key_points": ["point1", "point2", ...],
    "financial_highlights": ["highlight1", "highlight2", ...],
    "technical_highlights": ["highlight1", "highlight2", ...],
    "all_claims_to_verify": ["claim1", "claim2", ...],
    "missing_information": ["info1", "info2", ...]
}"""


async def summarize_chunk(chunk: DocumentChunk) -> dict:
    """
    Summarize a single document chunk.

    Args:
        chunk: The document chunk to summarize.

    Returns:
        Dict with summary and extracted key information.
    """
    llm = get_llm_client()

    context = f"Section: {chunk.section_title}\n"
    context += f"Pages: {', '.join(str(p) for p in chunk.page_numbers)}\n\n"
    context += chunk.text

    try:
        response = llm.chat(
            system_prompt=SUMMARIZE_SYSTEM_PROMPT,
            user_content=context,
            temperature=0.1,
            max_tokens=2048,
        )
        result = response["result"]
        logger.info(
            "chunk_summarized",
            section=chunk.section_title,
            input_words=chunk.word_count,
            tokens_used=response["tokens"],
        )
        return result
    except Exception as e:
        logger.error("chunk_summarize_failed", section=chunk.section_title, error=str(e))
        return {
            "summary": chunk.text[:500] + "..." if len(chunk.text) > 500 else chunk.text,
            "key_points": [],
            "financial_highlights": [],
            "technical_highlights": [],
            "claims_to_verify": [],
            "missing_information": [],
        }


async def create_executive_summary(
    chunks: list[DocumentChunk],
    chunk_summaries: Optional[list[dict]] = None,
) -> dict:
    """
    Create a unified executive summary from all chunks.

    If chunk_summaries are not provided, summarizes each chunk first.

    Args:
        chunks: All document chunks.
        chunk_summaries: Pre-computed chunk summaries (optional).

    Returns:
        Dict with executive summary and aggregated metadata.
    """
    llm = get_llm_client()

    # If we don't have chunk summaries, create them
    if chunk_summaries is None:
        chunk_summaries = []
        for chunk in chunks:
            summary = await summarize_chunk(chunk)
            chunk_summaries.append(summary)

    # If total content is small enough, skip the combine step
    all_summaries_text = "\n\n".join(
        f"[Section: {chunk.section_title}]\n{summary.get('summary', chunk.text[:300])}"
        for chunk, summary in zip(chunks, chunk_summaries)
    )

    total_tokens = estimate_token_count(all_summaries_text)

    if total_tokens <= 3000:
        # Small enough to combine directly
        try:
            response = llm.chat(
                system_prompt=COMBINE_SUMMARIES_PROMPT,
                user_content=all_summaries_text,
                temperature=0.1,
                max_tokens=3000,
            )
            logger.info("executive_summary_created", tokens_used=response["tokens"])
            return response["result"]
        except Exception as e:
            logger.error("executive_summary_failed", error=str(e))

    # If too large, just concatenate chunk summaries
    combined = {
        "executive_summary": "\n\n".join(
            s.get("summary", "") for s in chunk_summaries if s.get("summary")
        ),
        "key_points": [],
        "financial_highlights": [],
        "technical_highlights": [],
        "all_claims_to_verify": [],
        "missing_information": [],
    }

    for s in chunk_summaries:
        combined["key_points"].extend(s.get("key_points", []))
        combined["financial_highlights"].extend(s.get("financial_highlights", []))
        combined["technical_highlights"].extend(s.get("technical_highlights", []))
        combined["all_claims_to_verify"].extend(s.get("claims_to_verify", []))
        combined["missing_information"].extend(s.get("missing_information", []))

    # Deduplicate lists
    for key in ["key_points", "financial_highlights", "technical_highlights",
                 "all_claims_to_verify", "missing_information"]:
        combined[key] = list(dict.fromkeys(combined[key]))

    return combined
