"""
The seven AIAIC parameter agents.

Each is now a declaration, not an implementation: a role, the sections of the
document it needs, and the sub-questions it must answer with cited evidence. All
the machinery lives in BaseAgent.

Previously each agent was its own module with a hand-written prompt and its own
copy of the keyword list used to scrape context out of the whole document. Those
keyword lists were the routing, and they were wrong in ways nobody could see —
substring matches, no word boundaries, and no way to tell whether an agent had
actually been shown the part of the document it was judging. Routing is now a
declared property (`sections`), so it is auditable: every AgentResult records which
sections it was given.

WEIGHTS are the AIAIC scoring weights and must sum to 1.0.
"""

from __future__ import annotations

from app.agents.base_agent import BaseAgent


class ProblemRelevanceAgent(BaseAgent):
    name = "ProblemRelevanceAgent"
    parameter_key = "problem_relevance"
    parameter_label = "Problem & Relevance"
    sections = ("problem", "vision", "adoption")
    role_prompt = """
You assess whether a proposal addresses a REAL and RELEVANT agricultural problem for
farmers in Maharashtra, India.

You are looking for a problem that is specific, evidenced and actually felt by
farmers — not a technology looking for a use. A proposal that opens with the
capabilities of its AI model and works backwards to a problem is weaker than one
that starts from what farmers lose today and why.
"""
    questions = (
        ("pr1", "Is the agricultural problem clearly and specifically defined, rather than stated in generalities?"),
        ("pr2", "Is the scale and severity of the problem evidenced with concrete data (farmers affected, losses incurred, yield gaps)?"),
        ("pr3", "Is the problem specifically relevant to Maharashtra's farmers, crops, districts or agro-climatic conditions?"),
        ("pr4", "Are the intended beneficiaries identified concretely (which farmers, what landholding, which crops)?"),
    )


class SolutionReadinessAgent(BaseAgent):
    name = "SolutionReadinessAgent"
    parameter_key = "solution_readiness"
    parameter_label = "Solution & Technology Readiness"
    sections = ("solution", "pilot", "compliance")
    role_prompt = """
You assess the MATURITY of the proposed solution — how much of it actually exists.

Be sceptical of the gap between what is described and what is built. "We will
develop a model that predicts..." is a plan; "our model achieves 87% accuracy on
12,000 field images collected across 4 districts" is a working system. TRL claims
must be backed by what the document shows, not by the number the applicant chose to
write down.
"""
    questions = (
        ("sr1", "Is the technical approach described concretely enough to be assessed (models, data, architecture), rather than as buzzwords?"),
        ("sr2", "Is the claimed Technology Readiness Level supported by evidence of what has actually been built and tested?"),
        ("sr3", "Are the data sources identified, and is there a credible basis for having access to that data?"),
        ("sr4", "Is there evidence of validation — accuracy figures, field trials, pilots, or deployments — as opposed to intentions?"),
        ("sr5", "Is intellectual property or technical differentiation established, and is the claim substantiated?"),
    )


class PilotDesignAgent(BaseAgent):
    name = "PilotDesignAgent"
    parameter_key = "pilot_design"
    parameter_label = "Pilot Design & Feasibility"
    sections = ("pilot", "financial", "adoption")
    role_prompt = """
You assess whether the proposed PILOT is a real, executable plan.

A credible pilot has dated milestones, named districts, a budget that ties to the
activities, and an honest account of what could go wrong. A plan that lists only
optimistic phases with no dates, no costs and no risks is not a plan — it is an
aspiration, and you should score it as such.
"""
    questions = (
        ("pd1", "Is there a concrete workplan with milestones and a timeline, rather than vague phases?"),
        ("pd2", "Is the budget broken down and does it plausibly correspond to the activities proposed?"),
        ("pd3", "Are the deployment locations (districts, sites, partner organisations) specified?"),
        ("pd4", "Are risks identified honestly, with mitigations that are more than boilerplate?"),
        ("pd5", "Are the expected outputs measurable, with baselines and targets stated?"),
    )


class FarmerAdoptionAgent(BaseAgent):
    name = "FarmerAdoptionAgent"
    parameter_key = "farmer_adoption"
    parameter_label = "Farmer Adoption & Inclusion"
    sections = ("adoption", "business_model", "problem")
    role_prompt = """
You assess whether FARMERS will actually adopt and benefit from this.

The central question is affordability and access for a smallholder — not whether the
technology is impressive. Pay attention to who is expected to pay, whether training
and support exist, whether the design accounts for low literacy or poor connectivity,
and whether women and marginal farmers are genuinely included or merely mentioned.
"""
    questions = (
        ("fa1", "Are the benefits to farmers concrete and quantified (income gain, cost saved, yield improved)?"),
        ("fa2", "Is the solution affordable to a smallholder, and is it clear who bears the cost?"),
        ("fa3", "Is there a real training, extension or support plan to drive adoption?"),
        ("fa4", "Are gender and social inclusion addressed substantively rather than as a box-tick?"),
        ("fa5", "Are practical barriers to adoption (literacy, connectivity, language, device access) acknowledged and addressed?"),
    )


class ScaleUpAgent(BaseAgent):
    name = "ScaleUpAgent"
    parameter_key = "scaleup"
    parameter_label = "Business Model & Scale-up"
    sections = ("business_model", "financial", "solution")
    role_prompt = """
You assess whether this can SUSTAIN and SCALE beyond a grant-funded pilot.

Look for revenue that someone actually pays, traction that is measured rather than
projected, and unit economics that survive contact with a smallholder's ability to
pay. Treat a market-size figure ("India's agritech market is $24B") as close to
worthless on its own — what matters is evidence that this venture can capture any of
it.
"""
    questions = (
        ("su1", "Is there a revenue model, and is it clear who pays and how much?"),
        ("su2", "Is there evidence of real traction — paying customers, deployments, signed pipeline — rather than projections?"),
        ("su3", "Are unit economics presented, and do they hold up against the stated farmer affordability?"),
        ("su4", "Is there a credible path to scale beyond the pilot, without permanent grant dependence?"),
        ("su5", "Is the market opportunity evidenced in a way specific to this venture, not just a top-down industry figure?"),
    )


class TeamCapacityAgent(BaseAgent):
    name = "TeamCapacityAgent"
    parameter_key = "team_capacity"
    parameter_label = "Team & Capacity"
    sections = ("team", "identity")
    role_prompt = """
You assess whether this TEAM can execute this specific project.

The question is fit, not prestige. Relevant agricultural and deployment experience
matters more than brand-name employers. A strong AI team with no agricultural or
field-deployment experience is a genuine risk for a farmer-facing pilot, and you
should say so.

NOTE: you are shown identity fields here because team composition is recorded there.
Judge the people and the organisation's capacity. Do not reward or penalise the
company for its name or its reputation.
"""
    questions = (
        ("tc1", "Do the founders have relevant, evidenced experience for this specific project?"),
        ("tc2", "Does the core team cover the skills the project actually requires (technical, agricultural, field operations)?"),
        ("tc3", "Is there evidence of prior delivery — shipped products, completed deployments, past grants executed?"),
        ("tc4", "Does the organisation have the capacity (size, structure, partners) to run this pilot?"),
    )


class ComplianceAgent(BaseAgent):
    name = "ComplianceAgent"
    parameter_key = "compliance"
    parameter_label = "Compliance & Governance"
    sections = ("compliance", "solution")
    role_prompt = """
You assess DATA PROTECTION and RESPONSIBLE-AI posture.

The relevant law is India's DPDP Act. You are looking for evidence of actual
practice — how consent is obtained from farmers, where data is stored, who it is
shared with, how models are tested for failure — not a sentence asserting that the
applicant "is fully compliant with all applicable regulations", which is evidence of
nothing.
"""
    questions = (
        ("cp1", "Is DPDP Act compliance addressed with specific practices (consent, storage, retention, sharing) rather than a bare assertion?"),
        ("cp2", "Is farmer data governance described — what is collected, who owns it, who it is shared with?"),
        ("cp3", "Are model safety and failure modes considered (what happens when the model is wrong and a farmer acts on it)?"),
        ("cp4", "Are relevant certifications, approvals or standards evidenced?"),
    )


# AIAIC parameter weights. Must sum to 1.0 — asserted below rather than trusted.
WEIGHTS: dict[str, float] = {
    "problem_relevance": 0.15,
    "solution_readiness": 0.20,
    "pilot_design": 0.20,
    "farmer_adoption": 0.15,
    "scaleup": 0.15,
    "team_capacity": 0.10,
    "compliance": 0.05,
}

assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "AIAIC parameter weights must sum to 1.0"


PARAMETER_AGENTS: tuple[type[BaseAgent], ...] = (
    ProblemRelevanceAgent,
    SolutionReadinessAgent,
    PilotDesignAgent,
    FarmerAdoptionAgent,
    ScaleUpAgent,
    TeamCapacityAgent,
    ComplianceAgent,
)

PARAMETER_LABELS: dict[str, str] = {
    agent.parameter_key: agent.parameter_label for agent in PARAMETER_AGENTS
}
