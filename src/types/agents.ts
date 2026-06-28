// ── Stage identifiers ─────────────────────────────────────────────────────────

export type AgentStage =
  | "intake"
  | "classifier"
  | "model_selector"
  | "sizing"
  | "deployment_tco"
  | "recommendation";

export type StageType = "llm" | "engine";

// ── Agent 1: Intake ───────────────────────────────────────────────────────────

export interface IntakeOutput {
  industry: string;
  use_case: string;
  primary_goal: string;
  user_count: number;
  requests_per_user_per_day: number;
  concurrent_users: number;
  latency_requirement_ms: number;
  availability: "standard" | "high" | "critical";
  data_sensitivity: "public" | "internal" | "confidential" | "restricted";
  compliance: string[];           // e.g. ["PII", "PHI", "GDPR"]
  data_sources: string[];
  data_volume_gb: number;
  deployment_preference: "cloud" | "on-prem" | "hybrid" | "no-preference";
  timeline: string;
  team_size: string;
  budget_usd_month: number;
  lifecycle_stage: "poc" | "pilot" | "production";
  input_tokens_per_request: number;
  output_tokens_per_request: number;
}

// ── Engine 1: Classifier ──────────────────────────────────────────────────────

export type WorkloadPattern =
  | "RAG / Enterprise Copilot"
  | "Document AI"
  | "Agentic Automation"
  | "Fine-tuning"
  | "Training"
  | "General LLM Inference"
  | "Computer Vision"
  | "Predictive ML";

export type DataRisk = "Low" | "Medium" | "High";
export type ReadinessStatus = "Ready" | "Partially Ready" | "Not Ready";
export type VolumeCategory = "Small" | "Large" | "Very Large";

export interface ClassifierOutput {
  workload_pattern: WorkloadPattern;
  ai_technique: string;
  rag_required: boolean;
  embedding_required: boolean;
  fine_tuning_required: boolean;
  data_risk: DataRisk;
  data_volume_category: VolumeCategory;
  completeness_score: number;       // 0–100
  completeness_status: ReadinessStatus;
  missing_fields: string[];
  data_readiness_score: number;     // 0–100
  data_readiness_status: ReadinessStatus;
  hosting_preference: "Self-hosted / Private Cloud" | "Managed Cloud / API" | "Hybrid" | "No Preference";
  total_sequence_length: number;
}

// ── Agent 2: Model Selector (RAG) ─────────────────────────────────────────────

export interface ModelSpec {
  model_id: string;
  name: string;
  parameters_b: number;
  context_length: number;
  layers: number;
  kv_heads: number;
  head_dim: number;
  architecture: string;
  license: string;
  recommended_quantization: "FP16" | "INT8" | "INT4";
  quantization_bytes: 0.5 | 1 | 2 | 4;
  deployment_type: "on-prem" | "cloud-api" | "both";
  tier: "small" | "medium" | "large";
}

export interface ModelSelectorOutput {
  retrieved_models: ModelSpec[];    // top 3–5 from RAG
  selected_model: ModelSpec;
  ai_technique: string;
  precision: string;
  quantization_bytes: number;
  hosting_preference: string;
  context_window_valid: boolean;
  context_window_warning?: string;
  selection_rationale: string;
}

// ── Engine 2: Sizing ──────────────────────────────────────────────────────────

export interface SizingOutput {
  model_weights_memory_gb: number;
  kv_cache_memory_gb: number;
  runtime_overhead_gb: number;
  total_gpu_memory_gb: number;
  gpu_model: string;
  gpu_memory_gb: number;
  gpu_utilization: number;
  effective_gpu_memory_gb: number;
  gpus_required: number;
  nodes_required: number;
  gpus_per_node: number;
  available_memory_gb: number;
  memory_headroom_gb: number;
  deployment_classification: "Single GPU" | "Multi-GPU Single Node" | "Multi-GPU Multi-Node";
  daily_token_volume: number;
  monthly_token_volume: number;
  annual_token_volume: number;
}

// ── Agent 3: Deployment + TCO ─────────────────────────────────────────────────

export interface TcoYear {
  year1_usd: number;
  year3_usd: number;
}

export interface TcoCostRow {
  category: string;
  year1_usd: number;
  year3_usd: number;
}

export interface DeploymentTcoOutput {
  architecture_type: string;
  deployment_model: "Public Cloud" | "On-prem / Private AI-in-a-Box" | "Hybrid" | "Edge";
  cloud_provider: string;
  cloud_vm_sku: string;
  cloud_year1_usd: number;
  cloud_year3_usd: number;
  onprem_year1_usd: number;
  onprem_year3_usd: number;
  cost_per_1m_tokens_cloud: number;
  cost_per_1m_tokens_onprem: number;
  lower_cost_year1: "Cloud" | "On-prem";
  lower_cost_year3: "Cloud" | "On-prem";
  breakeven_month: number | null;
  cost_rows: TcoCostRow[];
  assumptions: string[];
}

// ── Agent 4: Recommendation ───────────────────────────────────────────────────

export type EngagementType =
  | "Advisory Only"
  | "AI Factory Lab POC"
  | "AI-in-a-Box Deployment"
  | "Managed AI Platform"
  | "FinOps Optimization"
  | "API-to-Self-Hosted Migration";

export interface RecommendationOutput {
  economic_recommendation: "Cloud" | "On-prem";
  compliance_override: boolean;
  final_recommendation: "Cloud" | "On-prem / Private AI-in-a-Box" | "Hybrid";
  confidence: "High" | "Medium" | "Low";
  confidence_rationale: string;
  engagement_type: EngagementType;
  rationale: string;
  executive_summary: string;
  risks: string[];
  next_steps: string[];
}

// ── Pipeline state ─────────────────────────────────────────────────────────────

export interface StageResult<T> {
  stage: AgentStage;
  type: StageType;
  output: T;
  raw: string;
  completedAt: Date;
}

export interface PipelineResult {
  intake: StageResult<IntakeOutput>;
  classifier: StageResult<ClassifierOutput>;
  model_selector: StageResult<ModelSelectorOutput>;
  sizing: StageResult<SizingOutput>;
  deployment_tco: StageResult<DeploymentTcoOutput>;
  recommendation: StageResult<RecommendationOutput>;
}

export interface PipelineState {
  status: "idle" | "running" | "completed" | "error";
  currentStage: AgentStage | null;
  error?: string;
}
