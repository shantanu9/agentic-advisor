import { ModelSpec } from "@/types/agents";
import { TtlCache } from "./cache";

// ── Architecture fallback specs ───────────────────────────────────────────────
// HuggingFace config.json doesn't always expose layers/kv_heads/head_dim.
// Keyed by architectureClass_paramBucket.

const ARCH_FALLBACKS: Record<string, Partial<ModelSpec>> = {
  "LlamaForCausalLM_7B":   { layers: 32, kv_heads: 8,  head_dim: 128 },
  "LlamaForCausalLM_8B":   { layers: 32, kv_heads: 8,  head_dim: 128 },
  "LlamaForCausalLM_70B":  { layers: 80, kv_heads: 8,  head_dim: 128 },
  "LlamaForCausalLM_405B": { layers: 126, kv_heads: 8, head_dim: 128 },
  "MistralForCausalLM":    { layers: 32, kv_heads: 8,  head_dim: 128 },
  "MixtralForCausalLM":    { layers: 32, kv_heads: 8,  head_dim: 128 },
  "Qwen2ForCausalLM_7B":   { layers: 28, kv_heads: 4,  head_dim: 128 },
  "Qwen2ForCausalLM_72B":  { layers: 80, kv_heads: 8,  head_dim: 128 },
  "Gemma2ForCausalLM_9B":  { layers: 42, kv_heads: 4,  head_dim: 256 },
  "Gemma2ForCausalLM_27B": { layers: 46, kv_heads: 16, head_dim: 128 },
  "Phi3ForCausalLM":       { layers: 40, kv_heads: 10, head_dim: 96  },
};

function archKey(architecture: string, parametersB: number): string {
  const bucket = parametersB < 15 ? (parametersB < 10 ? "7B" : "8B")
    : parametersB < 50 ? "27B"
    : parametersB < 100 ? "70B"
    : "405B";
  return `${architecture}_${bucket}`;
}

// ── HuggingFace response shape (partial) ─────────────────────────────────────

interface HfModel {
  modelId: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  library_name?: string;
  config?: {
    model_type?: string;
    architectures?: string[];
    num_hidden_layers?: number;
    num_key_value_heads?: number;
    hidden_size?: number;
    num_attention_heads?: number;
    max_position_embeddings?: number;
    num_parameters?: number;
  };
  cardData?: { license?: string };
}

// ── Parameter count → size bucket ─────────────────────────────────────────────

function sizeHintToParamRange(hint: "<7B" | "7B-70B" | ">70B"): { min: number; max: number } {
  if (hint === "<7B")    return { min: 0,  max: 6_999_999_999 };
  if (hint === "7B-70B") return { min: 7_000_000_000, max: 72_000_000_000 };
  return { min: 70_000_000_000, max: 999_000_000_000 };
}

// ── Parse a HuggingFace model into ModelSpec ───────────────────────────────────

function parseHfModel(hf: HfModel): ModelSpec | null {
  try {
    const cfg = hf.config ?? {};
    const architecture = cfg.architectures?.[0] ?? "";
    if (!architecture) return null;

    const rawParams = cfg.num_parameters ?? 0;
    const parametersB = rawParams > 0 ? Math.round(rawParams / 1e9 * 10) / 10 : 0;
    if (parametersB === 0) return null;

    const contextLength = cfg.max_position_embeddings ?? 4096;

    const fallback = ARCH_FALLBACKS[archKey(architecture, parametersB)] ??
                     ARCH_FALLBACKS[architecture] ?? {};

    const headDimRaw = cfg.hidden_size && cfg.num_attention_heads
      ? cfg.hidden_size / cfg.num_attention_heads
      : (fallback.head_dim ?? 128);

    const layers   = cfg.num_hidden_layers ?? fallback.layers ?? 32;
    const kvHeads  = cfg.num_key_value_heads ?? fallback.kv_heads ?? cfg.num_attention_heads ?? 8;
    const headDim  = Math.round(headDimRaw);

    const license = hf.cardData?.license ?? "unknown";
    const isOpenLicense = ["apache-2.0", "mit", "llama3", "llama3.1", "llama3.2",
                           "llama3.3", "gemma", "qwen", "open-rail"].some((l) => license.includes(l));
    if (!isOpenLicense) return null;

    const tier: ModelSpec["tier"] =
      parametersB < 7 ? "small" :
      parametersB < 40 ? "medium" : "large";

    const quantization: ModelSpec["recommended_quantization"] =
      parametersB >= 70 ? "FP16" : "INT8";

    return {
      model_id:                  hf.modelId,
      name:                      hf.modelId.split("/").pop() ?? hf.modelId,
      parameters_b:              parametersB,
      context_length:            contextLength,
      layers,
      kv_heads:                  kvHeads,
      head_dim:                  headDim,
      architecture,
      license,
      recommended_quantization:  quantization,
      quantization_bytes:        quantization === "FP16" ? 2 : 1,
      deployment_type:           "on-prem",
      tier,
    };
  } catch {
    return null;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const modelCache = new TtlCache<ModelSpec[]>();

// ── Main fetch function (called by retrieveModelsWithMcp) ─────────────────────

export async function fetchModelsFromHuggingFace(
  sizeHint: "<7B" | "7B-70B" | ">70B",
  workloadPattern: string,
  compliance: string[],
  topN = 10,
): Promise<ModelSpec[]> {
  const cacheKey = `${sizeHint}:${workloadPattern}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  try {
    const { min, max } = sizeHintToParamRange(sizeHint);
    const params = new URLSearchParams({
      pipeline_tag: "text-generation",
      sort: "downloads",
      direction: "-1",
      limit: "30",
      full: "true",
      config: "true",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`https://huggingface.co/api/models?${params}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`HuggingFace API returned ${res.status} — using static catalog only`);
      return [];
    }

    const hfModels: HfModel[] = await res.json();

    const regulated = ["PII", "PHI", "GDPR", "HIPAA", "SOC2", "Financial Regulation", "Sovereign"];
    const needsOnPrem = compliance.some((c) => regulated.includes(c));

    const parsed = hfModels
      .map(parseHfModel)
      .filter((m): m is ModelSpec => m !== null)
      .filter((m) => {
        const params = m.parameters_b * 1e9;
        return params >= min && params <= max;
      })
      .filter((m) => !needsOnPrem || m.deployment_type === "on-prem")
      .slice(0, topN);

    console.log(`[HuggingFace] fetched ${hfModels.length} raw → ${parsed.length} usable models for [${sizeHint}]`);
    modelCache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.warn("HuggingFace fetch failed — using static catalog only:", err);
    return [];
  }
}
