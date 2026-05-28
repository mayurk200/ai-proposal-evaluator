import { z } from 'zod';

export const evaluationResultSchema = z.object({
  overall_score: z.number().min(0).max(100),
  problem_relevance_score: z.number().min(0).max(100),
  technical_soundness_score: z.number().min(0).max(100),
  pilot_design_score: z.number().min(0).max(100),
  team_capability_score: z.number().min(0).max(100),
  market_potential_score: z.number().min(0).max(100),
  financial_sustainability_score: z.number().min(0).max(100),
  strategic_impact_score: z.number().min(0).max(100),
  recommendation: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  swot_analysis: z.object({
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
  }),
  summary: z.string(),
  investment_readiness: z.string().optional(),
  key_action_items: z.array(z.string()).optional(),
});

export const agentResponseSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  analysis: z.string().optional(),
  key_findings: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
}).passthrough();

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
