import { ModelSpec, WorkloadPattern } from "@/types/agents";

// Curated model list — fetched from HuggingFace config.json and cached here.
// To refresh: call fetchAndCacheModels() at build time or via an admin route.
const MODEL_CATALOG: ModelSpec[] = [
  {
    model_id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B Instruct",
    parameters_b: 8,
    context_length: 131072,
    layers: 32,
    kv_heads: 8,
    head_dim: 128,
    architecture: "LlamaForCausalLM",
    license: "llama3.1",
    recommended_quantization: "INT8",
    quantization_bytes: 1,
    deployment_type: "on-prem",
    tier: "small",
  },
  {
    model_id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    name: "Llama 3.1 70B Instruct",
    parameters_b: 70,
    context_length: 131072,
    layers: 80,
    kv_heads: 8,
    head_dim: 128,
    architecture: "LlamaForCausalLM",
    license: "llama3.1",
    recommended_quantization: "FP16",
    quantization_bytes: 2,
    deployment_type: "on-prem",
    tier: "large",
  },
  {
    model_id: "meta-llama/Meta-Llama-3.1-405B-Instruct",
    name: "Llama 3.1 405B Instruct",
    parameters_b: 405,
    context_length: 131072,
    layers: 126,
    kv_heads: 8,
    head_dim: 128,
    architecture: "LlamaForCausalLM",
    license: "llama3.1",
    recommended_quantization: "INT4",
    quantization_bytes: 0.5,
    deployment_type: "on-prem",
    tier: "large",
  },
  {
    model_id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct v0.3",
    parameters_b: 7,
    context_length: 32768,
    layers: 32,
    kv_heads: 8,
    head_dim: 128,
    architecture: "MistralForCausalLM",
    license: "apache-2.0",
    recommended_quantization: "INT8",
    quantization_bytes: 1,
    deployment_type: "both",
    tier: "small",
  },
  {
    model_id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    name: "Mixtral 8x7B Instruct",
    parameters_b: 46.7,
    context_length: 32768,
    layers: 32,
    kv_heads: 8,
    head_dim: 128,
    architecture: "MixtralForCausalLM",
    license: "apache-2.0",
    recommended_quantization: "INT8",
    quantization_bytes: 1,
    deployment_type: "on-prem",
    tier: "medium",
  },
  {
    model_id: "microsoft/Phi-3-medium-128k-instruct",
    name: "Phi-3 Medium 14B",
    parameters_b: 14,
    context_length: 131072,
    layers: 40,
    kv_heads: 10,
    head_dim: 96,
    architecture: "Phi3ForCausalLM",
    license: "mit",
    recommended_quantization: "INT8",
    quantization_bytes: 1,
    deployment_type: "both",
    tier: "medium",
  },
  {
    model_id: "google/gemma-2-9b-it",
    name: "Gemma 2 9B Instruct",
    parameters_b: 9,
    context_length: 8192,
    layers: 42,
    kv_heads: 4,
    head_dim: 256,
    architecture: "Gemma2ForCausalLM",
    license: "gemma",
    recommended_quantization: "INT8",
    quantization_bytes: 1,
    deployment_type: "both",
    tier: "small",
  },
  {
    model_id: "google/gemma-2-27b-it",
    name: "Gemma 2 27B Instruct",
    parameters_b: 27,
    context_length: 8192,
    layers: 46,
    kv_heads: 16,
    head_dim: 128,
    architecture: "Gemma2ForCausalLM",
    license: "gemma",
    recommended_quantization: "FP16",
    quantization_bytes: 2,
    deployment_type: "on-prem",
    tier: "medium",
  },
  {
    model_id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B Instruct",
    parameters_b: 72,
    context_length: 131072,
    layers: 80,
    kv_heads: 8,
    head_dim: 128,
    architecture: "Qwen2ForCausalLM",
    license: "qwen",
    recommended_quantization: "FP16",
    quantization_bytes: 2,
    deployment_type: "on-prem",
    tier: "large",
  },
];

// Workload → preferred model tiers
const WORKLOAD_TIER_MAP: Record<WorkloadPattern, string[]> = {
  "RAG / Enterprise Copilot":   ["medium", "large"],
  "Document AI":                ["small", "medium"],
  "Agentic Automation":         ["large"],
  "Fine-tuning":                ["medium", "large"],
  "Training":                   ["large"],
  "General LLM Inference":      ["small", "medium", "large"],
  "Computer Vision":            ["small", "medium"],
  "Predictive ML":              ["small"],
};

// Compliance → deployment type filter
function deploymentTypeFromCompliance(compliance: string[]): ModelSpec["deployment_type"][] {
  const regulated = ["PII", "PHI", "GDPR", "HIPAA", "SOC2", "Financial Regulation", "Sovereign"];
  const isRegulated = compliance.some((c) => regulated.includes(c));
  return isRegulated ? ["on-prem"] : ["on-prem", "cloud-api", "both"];
}

// RAG retrieval — returns top N models matching workload + size + compliance
export function retrieveModels(
  workloadPattern: WorkloadPattern,
  modelSizeHint: "<7B" | "7B-70B" | ">70B",
  compliance: string[],
  topN = 5
): ModelSpec[] {
  const preferredTiers = WORKLOAD_TIER_MAP[workloadPattern] ?? ["small", "medium", "large"];
  const allowedDeployment = deploymentTypeFromCompliance(compliance);

  const sizeFilter = (m: ModelSpec) => {
    if (modelSizeHint === "<7B")   return m.parameters_b < 7;
    if (modelSizeHint === "7B-70B") return m.parameters_b >= 7 && m.parameters_b <= 70;
    return m.parameters_b > 70;
  };

  const deploymentFilter = (m: ModelSpec) =>
    allowedDeployment.includes(m.deployment_type) || m.deployment_type === "both";

  const scored = MODEL_CATALOG.filter(sizeFilter).filter(deploymentFilter).map((m) => {
    const tierScore = preferredTiers.indexOf(m.tier) !== -1
      ? (preferredTiers.length - preferredTiers.indexOf(m.tier)) * 10
      : 0;
    const sizeScore = modelSizeHint === ">70B" ? (m.parameters_b > 70 ? 20 : 0)
      : modelSizeHint === "<7B" ? (m.parameters_b < 7 ? 20 : 0)
      : 10;
    return { model: m, score: tierScore + sizeScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.model);
}

export function formatModelsForPrompt(models: ModelSpec[]): string {
  return models.map((m, i) =>
    `[${i + 1}] ${m.name} (${m.parameters_b}B params, ctx ${m.context_length} tokens, ` +
    `${m.layers} layers, ${m.kv_heads} KV heads, head_dim ${m.head_dim}, ` +
    `recommended precision: ${m.recommended_quantization}, license: ${m.license}, ` +
    `deployment: ${m.deployment_type})`
  ).join("\n");
}

export function getModelById(modelId: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.model_id === modelId);
}

export function getAllModels(): ModelSpec[] {
  return MODEL_CATALOG;
}
