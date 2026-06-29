import { describe, it, expect } from "vitest";
import { runSizingEngine } from "@/lib/sizing-engine";
import type { ModelSelectorOutput, ClassifierOutput } from "@/types/agents";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const LLAMA_70B: ModelSelectorOutput["selected_model"] = {
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
};

const MIXTRAL_8X7B: ModelSelectorOutput["selected_model"] = {
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
};

function makeModelSelector(model: typeof LLAMA_70B): ModelSelectorOutput {
  return {
    retrieved_models: [model],
    selected_model: model,
    ai_technique: "RAG + LLM + Embeddings",
    precision: model.recommended_quantization,
    quantization_bytes: model.quantization_bytes,
    hosting_preference: "Self-hosted / Private Cloud",
    context_window_valid: true,
    selection_rationale: "test",
  };
}

const RAG_CLASSIFIER: ClassifierOutput = {
  workload_pattern: "RAG / Enterprise Copilot",
  ai_technique: "RAG + LLM + Embeddings",
  rag_required: true,
  embedding_required: true,
  fine_tuning_required: false,
  data_risk: "High",
  data_volume_category: "Small",
  completeness_score: 100,
  completeness_status: "Ready",
  missing_fields: [],
  data_readiness_score: 100,
  data_readiness_status: "Ready",
  hosting_preference: "Self-hosted / Private Cloud",
  total_sequence_length: 9000,
};

// ── Memory formula tests ───────────────────────────────────────────────────────

describe("sizing — model weights memory", () => {
  it("computes 168 GB for Llama 70B FP16 (70 × 2 × 1.2)", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 1);
    expect(out.model_weights_memory_gb).toBeCloseTo(168, 1);
  });

  it("computes ~56 GB for Mixtral 8x7B INT8 (46.7 × 1 × 1.2)", () => {
    const out = runSizingEngine(makeModelSelector(MIXTRAL_8X7B), RAG_CLASSIFIER, 3000, 10, 1);
    expect(out.model_weights_memory_gb).toBeCloseTo(56.04, 1);
  });
});

describe("sizing — KV cache memory", () => {
  it("computes ~0 GB KV cache with 1 concurrent user (Llama 70B)", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 1);
    // 2 × 1 × 9000 × 80 × 8 × 128 × 2 / 1024³ ≈ 2.75 GB
    expect(out.kv_cache_memory_gb).toBeCloseTo(2.75, 0);
  });

  it("computes ~337 GB KV cache for 123 concurrent users (Llama 70B, 9000 tokens)", () => {
    // 2 × 123 × 9000 × 80 × 8 × 128 × 2 / 1024³
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.kv_cache_memory_gb).toBeCloseTo(337.8, 0);
  });

  it("KV cache scales linearly with concurrent users", () => {
    const out1 = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 100);
    const out2 = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 200);
    expect(out2.kv_cache_memory_gb / out1.kv_cache_memory_gb).toBeCloseTo(2.0, 1);
  });
});

// ── GPU count tests — the critical 8-H100 scenario ────────────────────────────

describe("sizing — 8 H100 reference scenario", () => {
  it("produces exactly 8 H100 GPUs for Llama 70B with 123 concurrent users", () => {
    // Total memory = 168 (weights) + ~337.8 (KV) + 4 (runtime) = ~509.8 GB
    // H100 effective = 64 GB → CEIL(509.8 / 64) = 8
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.gpu_model).toMatch(/H100/i);
    expect(out.gpus_required).toBe(8);
    expect(out.nodes_required).toBe(1);
    expect(out.deployment_classification).toBe("Multi-GPU Single Node");
  });

  it("total GPU memory for the 8-H100 scenario is ≤ 512 GB (fits in 1 node)", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.total_gpu_memory_gb).toBeLessThanOrEqual(512);
    expect(out.total_gpu_memory_gb).toBeGreaterThan(448); // must need more than 7 GPUs
  });

  it("headroom is positive (no over-allocation)", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.memory_headroom_gb).toBeGreaterThanOrEqual(0);
  });
});

describe("sizing — GPU scales with concurrency", () => {
  it("needs more GPUs for 300 concurrent users than for 123", () => {
    const out123 = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    const out300 = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 300);
    expect(out300.gpus_required).toBeGreaterThan(out123.gpus_required);
  });

  it("needs >1 node for 300 concurrent users with Llama 70B", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 300);
    expect(out.nodes_required).toBeGreaterThan(1);
    expect(out.gpu_model).toMatch(/H100/i);
  });
});

// ── Token volume tests ─────────────────────────────────────────────────────────

describe("sizing — token volumes", () => {
  it("daily token volume = users × requests × sequence_length", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    // 3000 users × 10 req/day × 9000 tokens
    expect(out.daily_token_volume).toBe(270_000_000);
  });

  it("monthly = daily × 30", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.monthly_token_volume).toBe(out.daily_token_volume * 30);
  });

  it("annual = daily × 360", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.annual_token_volume).toBe(out.daily_token_volume * 360);
  });
});

// ── Deployment classification ──────────────────────────────────────────────────

describe("sizing — deployment classification", () => {
  it("classifies 1 GPU as Single GPU", () => {
    // Use a tiny classifier with 1-token sequence to force 1 GPU
    const tinyClassifier = { ...RAG_CLASSIFIER, total_sequence_length: 10 };
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), tinyClassifier, 100, 1, 1);
    // With 1 user and tiny seq, KV cache ≈ 0, total ≈ 172 GB → still multiple GPUs with Llama 70B
    // Test classification logic directly via a small model instead
    const SMALL_MODEL = { ...LLAMA_70B, parameters_b: 1, layers: 4 };
    const out2 = runSizingEngine(makeModelSelector(SMALL_MODEL), tinyClassifier, 100, 1, 1);
    expect(out2.deployment_classification).toBe("Single GPU");
  });

  it("classifies 4–8 GPUs on 1 node as Multi-GPU Single Node", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 123);
    expect(out.deployment_classification).toBe("Multi-GPU Single Node");
  });

  it("classifies >8 GPUs as Multi-GPU Multi-Node", () => {
    const out = runSizingEngine(makeModelSelector(LLAMA_70B), RAG_CLASSIFIER, 3000, 10, 300);
    expect(out.deployment_classification).toBe("Multi-GPU Multi-Node");
  });
});
