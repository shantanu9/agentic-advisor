export type AgentType = "discovery" | "workload" | "deployment" | "tco";

// ── Structured outputs per agent ──────────────────────────────────────────────

export interface DiscoveryOutput {
  use_case: string;
  data: { type: string; volume: string; format: string };
  scale: { users: string; requests_per_sec: string; latency_tolerance: string };
  constraints: { budget: string; timeline: string; team_size: string; regulatory: string };
  success_metrics: string[];
}

export interface WorkloadOutput {
  primary_type: "Training" | "Inference" | "Fine-tuning" | "RAG" | "Agentic" | "Multi-agent" | "Mixed";
  compute_intensity: "Low" | "Medium" | "High" | "Extreme";
  memory_requirement: string;
  latency_class: "Real-time" | "Near-real-time" | "Batch";
  model_size_recommendation: "<7B" | "7B-70B" | ">70B";
  data_pipeline_needed: boolean;
  reasoning: string;
}

export interface DeploymentOption {
  option: string;
  provider_examples: string[];
  estimated_cost_usd_month: string;
  pros: string[];
  cons: string[];
  best_for: string;
}

export interface DeploymentOutput {
  options: DeploymentOption[];
  recommended: string;
  recommendation_reason: string;
  gpu_specs_used: string[];
}

export interface TcoCost {
  category: string;
  year1_usd: number;
  year3_usd: number;
}

export interface TcoOutput {
  assumptions: string[];
  costs: TcoCost[];
  total_year1_usd: number;
  total_year3_usd: number;
  total_year1_inr: number;
  total_year3_inr: number;
  key_insight: string;
}

export type StructuredOutput = DiscoveryOutput | WorkloadOutput | DeploymentOutput | TcoOutput;

// ── Pipeline state ─────────────────────────────────────────────────────────────

export interface AgentResponse {
  agent: AgentType;
  output: StructuredOutput;
  raw: string;
  completedAt: Date;
}

export interface PipelineState {
  status: "idle" | "running" | "completed" | "error";
  currentAgent: AgentType | null;
  results: Partial<Record<AgentType, AgentResponse>>;
  error?: string;
}

export interface BusinessRequirement {
  description: string;
}

export interface PipelineResult {
  discovery: AgentResponse;
  workload: AgentResponse;
  deployment: AgentResponse;
  tco: AgentResponse;
}
