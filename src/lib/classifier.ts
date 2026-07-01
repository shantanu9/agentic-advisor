import { IntakeOutput, ClassifierOutput, WorkloadPattern, DataRisk, ReadinessStatus, VolumeCategory } from "@/types/agents";

// ── Workload pattern keyword mapping (PRD §17.2) ──────────────────────────────

const WORKLOAD_RULES: Array<{ keywords: string[]; pattern: WorkloadPattern; technique: string; rag: boolean; embedding: boolean; finetune: boolean }> = [
  {
    keywords: ["copilot", "assistant", "chatbot", "q&a", "qa", "knowledge", "search", "policy", "summarize", "summarisation", "faq", "helpdesk", "support"],
    pattern: "RAG / Enterprise Copilot",
    technique: "RAG + LLM + Embeddings",
    rag: true, embedding: true, finetune: false,
  },
  {
    keywords: ["claim", "invoice", "form", "document", "pdf", "contract", "ocr", "extraction", "parse", "classify document"],
    pattern: "Document AI",
    technique: "Document Parsing + LLM Extraction",
    rag: false, embedding: false, finetune: false,
  },
  {
    keywords: ["automation", "agentic", "agent", "orchestrat", "tool", "ticket", "workflow", "task", "multi-step", "multi step"],
    pattern: "Agentic Automation",
    technique: "Agents + Tool Calling + Workflow Orchestration",
    rag: true, embedding: false, finetune: false,
  },
  {
    keywords: ["fine-tune", "fine tune", "finetune", "domain adapt", "customize model", "custom model"],
    pattern: "Fine-tuning",
    technique: "Supervised Fine-tuning (SFT) / LoRA",
    rag: false, embedding: false, finetune: true,
  },
  {
    keywords: ["train", "pre-train", "pretrain", "foundation model"],
    pattern: "Training",
    technique: "Distributed Training",
    rag: false, embedding: false, finetune: false,
  },
  {
    keywords: ["image", "vision", "object detect", "segmentation", "video"],
    pattern: "Computer Vision",
    technique: "Vision Transformer / CNN",
    rag: false, embedding: false, finetune: false,
  },
  {
    keywords: ["predict", "forecast", "classification", "regression", "tabular", "ml model"],
    pattern: "Predictive ML",
    technique: "Classical ML / Gradient Boosting",
    rag: false, embedding: false, finetune: false,
  },
];

function classifyWorkload(intake: IntakeOutput): typeof WORKLOAD_RULES[0] {
  const text = `${intake.use_case} ${intake.primary_goal}`.toLowerCase();
  for (const rule of WORKLOAD_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule;
  }
  return {
    keywords: [],
    pattern: "General LLM Inference",
    technique: "LLM Inference",
    rag: false, embedding: false, finetune: false,
  };
}

// ── Data risk (PRD §17.3) ──────────────────────────────────────────────────────

const HIGH_RISK_COMPLIANCE = ["PII", "PHI", "HIPAA", "Financial Regulation", "Sovereign", "Restricted", "GDPR", "SOC2", "PCI-DSS"];
const HIGH_RISK_SENSITIVITY = ["restricted"];
const MEDIUM_RISK_SENSITIVITY = ["confidential", "internal"];

function classifyDataRisk(intake: IntakeOutput): DataRisk {
  if (intake.compliance.some((c) => HIGH_RISK_COMPLIANCE.includes(c))) return "High";
  if (HIGH_RISK_SENSITIVITY.includes(intake.data_sensitivity)) return "High";
  if (MEDIUM_RISK_SENSITIVITY.includes(intake.data_sensitivity)) return "Medium";
  return "Low";
}

// ── Hosting preference ─────────────────────────────────────────────────────────

function deriveHostingPreference(intake: IntakeOutput, dataRisk: DataRisk): ClassifierOutput["hosting_preference"] {
  if (dataRisk === "High") return "Self-hosted / Private Cloud";
  if (intake.compliance.length > 0) return "Self-hosted / Private Cloud";
  if (intake.deployment_preference === "cloud") return "Managed Cloud / API";
  if (intake.deployment_preference === "hybrid") return "Hybrid";
  return "No Preference";
}

// ── Requirement completeness (PRD §17.1) ──────────────────────────────────────

const MANDATORY_FIELDS: Array<{ key: keyof IntakeOutput; label: string }> = [
  { key: "industry", label: "Industry" },
  { key: "use_case", label: "Use Case" },
  { key: "primary_goal", label: "Primary Goal" },
  { key: "user_count", label: "User Count" },
  { key: "requests_per_user_per_day", label: "Requests per User per Day" },
  { key: "latency_requirement_ms", label: "Latency Requirement" },
  { key: "data_sensitivity", label: "Data Sensitivity" },
  { key: "deployment_preference", label: "Deployment Preference" },
  { key: "budget_usd_month", label: "Budget" },
  { key: "lifecycle_stage", label: "Lifecycle Stage" },
];

function scoreCompleteness(intake: IntakeOutput): { score: number; status: ReadinessStatus; missing: string[] } {
  const missing: string[] = [];
  for (const f of MANDATORY_FIELDS) {
    const v = intake[f.key];
    if (v === undefined || v === null || v === "" || v === 0) missing.push(f.label);
  }
  const score = Math.round(((MANDATORY_FIELDS.length - missing.length) / MANDATORY_FIELDS.length) * 100);
  const status: ReadinessStatus = score >= 90 ? "Ready" : score >= 70 ? "Partially Ready" : "Not Ready";
  return { score, status, missing };
}

// ── Data readiness (PRD §17.3) ────────────────────────────────────────────────

function scoreDataReadiness(intake: IntakeOutput): { score: number; status: ReadinessStatus } {
  let score = 0;
  // Data quality proxy: data_volume_gb > 0 and data_sources not empty
  if (intake.data_volume_gb > 0) score += 25;
  if (intake.data_sources.length > 0) score += 25;
  // Access proxy: deployment_preference given
  if (intake.deployment_preference !== "no-preference") score += 25;
  // Labeling proxy: use_case specificity (non-empty, >20 chars)
  if (intake.use_case.length > 20) score += 25;
  const status: ReadinessStatus = score >= 50 ? "Ready" : "Not Ready";
  return { score, status };
}

// ── Volume category (PRD §17.3) ───────────────────────────────────────────────

function classifyVolume(gb: number): VolumeCategory {
  if (gb <= 500)   return "Small";
  if (gb <= 10240) return "Large";
  return "Very Large";
}

// ── Context window ─────────────────────────────────────────────────────────────

function calcSequenceLength(intake: IntakeOutput): number {
  return intake.input_tokens_per_request + intake.output_tokens_per_request + 1000; // +1000 RAG/misc
}

// ── Model size hint ────────────────────────────────────────────────────────────

function deriveModelSizeHint(
  pattern: WorkloadPattern,
  concurrentUsers = 0,
  lifecycleStage: "poc" | "pilot" | "production" = "production",
  latencyMs = 2000,
  budgetUsdMonth = 50000,
): "<7B" | "7B-70B" | ">70B" {
  // POC + tight budget → small model sufficient
  if (lifecycleStage === "poc" && budgetUsdMonth < 5000) return "<7B";
  // Very low latency + low concurrency → small fast model
  if (latencyMs < 300 && concurrentUsers < 50) return "<7B";
  // Structured/non-generative workloads → small model
  if (pattern === "Predictive ML" || pattern === "Computer Vision") return "<7B";
  // Large-scale training always needs >70B
  if (pattern === "Training") return ">70B";
  if (pattern === "Agentic Automation") return ">70B";
  // High-concurrency RAG needs a large model for KV cache throughput
  if (pattern === "RAG / Enterprise Copilot" && concurrentUsers >= 100) return "7B-70B";
  if (["Fine-tuning", "RAG / Enterprise Copilot"].includes(pattern)) return "7B-70B";
  return "7B-70B";
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function runClassifier(intake: IntakeOutput): ClassifierOutput {
  const workloadRule = classifyWorkload(intake);
  const dataRisk = classifyDataRisk(intake);
  const hosting = deriveHostingPreference(intake, dataRisk);
  const completeness = scoreCompleteness(intake);
  const dataReadiness = scoreDataReadiness(intake);
  const volumeCategory = classifyVolume(intake.data_volume_gb);
  const sequenceLength = calcSequenceLength(intake);

  return {
    workload_pattern: workloadRule.pattern,
    ai_technique: workloadRule.technique,
    rag_required: workloadRule.rag,
    embedding_required: workloadRule.embedding,
    fine_tuning_required: workloadRule.finetune,
    data_risk: dataRisk,
    data_volume_category: volumeCategory,
    completeness_score: completeness.score,
    completeness_status: completeness.status,
    missing_fields: completeness.missing,
    data_readiness_score: dataReadiness.score,
    data_readiness_status: dataReadiness.status,
    hosting_preference: hosting,
    total_sequence_length: sequenceLength,
  };
}

export function deriveModelSizeHintFromClassifier(
  pattern: WorkloadPattern,
  concurrentUsers = 0,
  lifecycleStage: "poc" | "pilot" | "production" = "production",
  latencyMs = 2000,
  budgetUsdMonth = 50000,
): "<7B" | "7B-70B" | ">70B" {
  return deriveModelSizeHint(pattern, concurrentUsers, lifecycleStage, latencyMs, budgetUsdMonth);
}
