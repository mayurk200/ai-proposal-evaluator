"""
Extraction Agent — AIAIC-field-aware structured data extraction.

Extracts all mapped fields from the proposal that downstream
parameter agents need for evaluation.
"""

from app.agents.base_agent import BaseAgent


class ExtractionAgent(BaseAgent):
    """Extracts structured AIAIC proposal data for downstream agents."""

    name = "ExtractionAgent"

    system_prompt = """You are an expert document analyst specializing in agricultural innovation proposals.

Your task is to extract ALL relevant structured data from this AIAIC (AI in Agriculture Innovation Challenge) proposal. You must be thorough — downstream evaluation agents depend on this extraction.

## CRITICAL: Extract the following fields (use exact field names):

### Identity & Meta
- application_id: The AIAI-XXXXXX application identifier
- company_name: Legal entity name
- project_name: Project/Product name
- problem_statement: Which problem track (Climate Resilience, Supply Chain, etc.)
- application_track: Track 1 (Scale-up) or Track 2 (Pilot and Validation)
- year_of_incorporation: When the company was founded
- employees_count: Number of employees
- state: Registered state
- stage: Company stage (Seed, Series A, etc.)

### Solution & Technology
- solution_synopsis: Full solution description
- technology_details: Detailed technology explanation including AI/ML specifics
- trl_level: Technology Readiness Level (TRL 1-9)
- ip_status: Intellectual property status (patents, etc.)
- data_sources_used: What data does the solution use
- open_source_technologies: Open-source tech incorporated

### Traction & Validation
- current_customers_pilots: Existing customers, pilots, deployments
- revenue_data: Revenue figures (if any)
- funding_raised: Total funding raised
- unit_economics: Cost per farmer, revenue per transaction, etc.
- committed_pipeline: LOIs, pipeline agreements

### Value & Impact
- unique_value_proposition: UVP for the target customer
- farmer_centric_benefits: Specific benefits to farmers (list)
- farmer_count_target: Number of farmers to impact
- pricing_strategy: How the solution is priced
- gender_social_inclusion_plan: Plan for including women, smallholders, marginal groups

### Market & Business
- revenue_model: How the business makes money
- business_sustainability: How the business sustains long-term
- market_size: TAM, SAM, SOM figures
- go_to_market_strategy: GTM approach
- prior_govt_collaboration: Any government partnerships/implementations
- competitive_landscape: Key competitors/differentiation

### Pilot Design
- project_duration_months: Proposed pilot duration
- total_project_cost_inr: Total budget in INR
- workplan_milestones: Key milestones and timeline
- risk_assessment: Identified risks
- risk_mitigation: Proposed mitigations
- training_capacity_plan: Training approach for farmers/teams
- expected_outputs: Expected deliverables and outcomes
- baseline_values: Baseline metrics for measurement
- proposed_districts: Target districts/talukas in Maharashtra

### Team
- founders: List of founders with name, role, qualifications, experience
- core_team: List of team members with name, role, qualifications, expertise

### Compliance
- dpdp_compliance: DPDP Act compliance measures
- model_safety_practices: AI model safety and fairness practices

### Strategic
- maharashtra_strategic_impact: Strategic alignment with Maharashtra agriculture

## Output Format (JSON):
{
    "score": <completeness score 0-100>,
    "confidence": <0.0-1.0>,
    "analysis": "<brief summary of what was found vs missing>",
    "extracted_data": {
        "<field_name>": "<extracted value or 'NOT FOUND'>",
        ...
    },
    "key_findings": ["<list of notable items found>"],
    "red_flags": ["<missing critical fields>"],
    "recommendations": [],
    "completeness_metrics": {
        "total_fields": <number>,
        "fields_found": <number>,
        "fields_missing": ["<list of missing field names>"]
    }
}"""

    max_tokens = 6144  # Needs more tokens for comprehensive extraction
