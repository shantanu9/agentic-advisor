export interface GpuSpec {
  model: string;
  vram_gb: number;
  tflops_fp16: number;
  tdp_watts: number;
  use_cases: string[];
  cloud_price_usd_hour: number;
  cloud_providers: string[];
  on_prem_price_usd: number;
  notes: string;
}

export const GPU_KNOWLEDGE_BASE: GpuSpec[] = [
  {
    model: "NVIDIA H100 SXM5 80GB",
    vram_gb: 80,
    tflops_fp16: 1979,
    tdp_watts: 700,
    use_cases: ["LLM training", "Large model inference", "Fine-tuning 70B+", "Multi-modal"],
    cloud_price_usd_hour: 4.50,
    cloud_providers: ["AWS p4de", "GCP A3", "Azure NDH100", "Lambda Labs", "CoreWeave"],
    on_prem_price_usd: 30000,
    notes: "Best-in-class for large model training. NVLink for multi-GPU. High power draw requires data center cooling.",
  },
  {
    model: "NVIDIA A100 SXM4 80GB",
    vram_gb: 80,
    tflops_fp16: 312,
    tdp_watts: 400,
    use_cases: ["LLM training", "Fine-tuning", "Large batch inference", "Scientific computing"],
    cloud_price_usd_hour: 3.00,
    cloud_providers: ["AWS p4d", "GCP A2", "Azure NDasrA100", "Lambda Labs", "CoreWeave"],
    on_prem_price_usd: 15000,
    notes: "Previous gen workhorse. Still widely available and cost-effective for fine-tuning.",
  },
  {
    model: "NVIDIA A10G 24GB",
    vram_gb: 24,
    tflops_fp16: 125,
    tdp_watts: 150,
    use_cases: ["Inference", "Small model fine-tuning", "RAG serving", "Agentic workloads"],
    cloud_price_usd_hour: 0.75,
    cloud_providers: ["AWS g5", "Lambda Labs", "CoreWeave"],
    on_prem_price_usd: 4000,
    notes: "Best price-performance for inference. Great for serving 7B-13B models. Low power draw.",
  },
  {
    model: "NVIDIA L4 24GB",
    vram_gb: 24,
    tflops_fp16: 121,
    tdp_watts: 72,
    use_cases: ["Inference", "RAG", "Agentic", "Edge deployment"],
    cloud_price_usd_hour: 0.60,
    cloud_providers: ["GCP G2", "CoreWeave"],
    on_prem_price_usd: 3500,
    notes: "Extremely power-efficient. Ideal for always-on inference. Low TCO over 3 years.",
  },
  {
    model: "NVIDIA RTX 4090 24GB",
    vram_gb: 24,
    tflops_fp16: 165,
    tdp_watts: 450,
    use_cases: ["Local inference", "Small model fine-tuning", "Dev/test"],
    cloud_price_usd_hour: 0.49,
    cloud_providers: ["Lambda Labs", "Vast.ai", "RunPod"],
    on_prem_price_usd: 1800,
    notes: "Consumer card. Not enterprise-grade but lowest entry cost for on-prem experimentation.",
  },
  {
    model: "Frontier LLM API (GPT-4o / Claude 3.5 / Gemini 1.5)",
    vram_gb: 0,
    tflops_fp16: 0,
    tdp_watts: 0,
    use_cases: ["Inference", "RAG", "Agentic", "Rapid prototyping", "Low volume"],
    cloud_price_usd_hour: 0,
    cloud_providers: ["OpenAI", "Anthropic", "Google", "Groq", "Azure OpenAI"],
    on_prem_price_usd: 0,
    notes: "Pay-per-token. ~$0.005-$0.015 per 1K output tokens. No infra management. Best for <1M tokens/day.",
  },
];

export function getRelevantGpus(workloadType: string, modelSize: string): GpuSpec[] {
  const lower = workloadType.toLowerCase();
  return GPU_KNOWLEDGE_BASE.filter((gpu) => {
    if (lower.includes("training") || lower.includes("fine-tuning")) {
      return gpu.use_cases.some(u => u.includes("training") || u.includes("fine-tuning"));
    }
    if (lower.includes("inference") || lower.includes("rag") || lower.includes("agentic")) {
      return gpu.use_cases.some(u => u.includes("inference") || u.includes("RAG") || u.includes("Agentic"));
    }
    return true;
  }).filter((gpu) => {
    if (modelSize === ">70B") return gpu.vram_gb >= 80 || gpu.model.includes("Frontier");
    if (modelSize === "7B-70B") return gpu.vram_gb >= 24 || gpu.model.includes("Frontier");
    return true;
  });
}

export function formatGpuContext(gpus: GpuSpec[]): string {
  return gpus.slice(0, 4).map(g =>
    `${g.model} | VRAM:${g.vram_gb > 0 ? `${g.vram_gb}GB` : "API"} | Cloud:${g.cloud_price_usd_hour > 0 ? `$${g.cloud_price_usd_hour}/hr` : "per-token"} | On-prem:${g.on_prem_price_usd > 0 ? `$${g.on_prem_price_usd.toLocaleString()}` : "N/A"} | ${g.notes}`
  ).join("\n");
}
