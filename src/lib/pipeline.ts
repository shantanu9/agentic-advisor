import Groq from "groq-sdk";
import {
  AgentResponse, AgentType, PipelineResult,
  DiscoveryOutput, WorkloadOutput, DeploymentOutput, TcoOutput,
} from "@/types/agents";
import { getRelevantGpus, formatGpuContext } from "./gpu-knowledge-base";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 120000 });
const MODEL = "llama-3.1-8b-instant";

const SYSTEM_PROMPTS: Record<AgentType, string> = {
  discovery: `You are a Discovery Agent. Extract structured information from the business requirement.
Respond with ONLY valid JSON matching this exact schema (no markdown, no extra text):
{
  "use_case": "string — one sentence describing the core problem",
  "data": { "type": "string", "volume": "string", "format": "string" },
  "scale": { "users": "string", "requests_per_sec": "string", "latency_tolerance": "string" },
  "constraints": { "budget": "string", "timeline": "string", "team_size": "string", "regulatory": "string" },
  "success_metrics": ["string", "string"]
}
If information is not provided, make a reasonable inference and note it. Output ONLY the JSON object.`,

  workload: `You are a Workload Profiling Agent. Classify the AI workload based on discovery output.
Respond with ONLY valid JSON matching this exact schema (no markdown, no extra text):
{
  "primary_type": "one of: Training | Inference | Fine-tuning | RAG | Agentic | Multi-agent | Mixed",
  "compute_intensity": "one of: Low | Medium | High | Extreme",
  "memory_requirement": "string e.g. '24GB VRAM minimum'",
  "latency_class": "one of: Real-time | Near-real-time | Batch",
  "model_size_recommendation": "one of: <7B | 7B-70B | >70B",
  "data_pipeline_needed": true or false,
  "reasoning": "string — 2-3 sentences explaining your classification"
}
Output ONLY the JSON object.`,

  deployment: `You are a Deployment Options Agent. Given the discovery, workload profile, and GPU knowledge base below, recommend deployment options.
Respond with ONLY valid JSON matching this exact schema (no markdown, no extra text):
{
  "options": [
    {
      "option": "string e.g. 'Frontier LLM API'",
      "provider_examples": ["string"],
      "estimated_cost_usd_month": "string e.g. '$200-500/month'",
      "pros": ["string"],
      "cons": ["string"],
      "best_for": "string"
    }
  ],
  "recommended": "string — name of recommended option",
  "recommendation_reason": "string — 2-3 sentences",
  "gpu_specs_used": ["string — GPU models referenced"]
}
Include 2-3 options (API, Cloud GPU, On-prem if applicable). Use real GPU specs from the knowledge base. Output ONLY the JSON object.`,

  tco: `You are a TCO Agent. Calculate total cost of ownership based on all previous agent outputs.
Use 1 USD = 84 INR. year3_usd = CUMULATIVE 3-year total for that category (not per-year).
Respond with ONLY valid JSON matching this exact schema (no markdown, no extra text):
{
  "assumptions": ["string"],
  "costs": [
    { "category": "string", "year1_usd": number, "year3_usd": number }
  ],
  "total_year1_usd": number,
  "total_year3_usd": number,
  "total_year1_inr": number,
  "total_year3_inr": number,
  "key_insight": "string — most important cost observation in 1-2 sentences"
}
Rules: year3_usd must always be >= year1_usd. total_year3_usd = sum of all year3_usd values. total_year1_inr = total_year1_usd * 84. total_year3_inr = total_year3_usd * 84. All cost values must be numbers. Include: Infrastructure/Compute, Development, Operations, Licensing. Output ONLY the JSON object.`,
};

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

async function runAgent(
  agentType: AgentType,
  userMessage: string,
  onChunk?: (chunk: string) => void
): Promise<{ output: unknown; raw: string }> {
  const stream = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[agentType] },
      { role: "user", content: userMessage },
    ],
    stream: true,
    max_tokens: 800,
    temperature: 0.2,
  });

  let raw = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      raw += delta;
      onChunk?.(delta);
    }
  }

  const output = parseJson(raw);
  return { output, raw };
}

export async function runPipeline(
  requirement: string,
  onProgress?: (agent: AgentType, chunk: string) => void
): Promise<PipelineResult> {
  // 1. Discovery
  onProgress?.("discovery", "");
  const discovery = await runAgent(
    "discovery",
    `Business Requirement: ${requirement}`,
    (c) => onProgress?.("discovery", c)
  );
  const discoveryResponse: AgentResponse = {
    agent: "discovery",
    output: discovery.output as DiscoveryOutput,
    raw: discovery.raw,
    completedAt: new Date(),
  };

  // 2. Workload
  onProgress?.("workload", "");
  const workload = await runAgent(
    "workload",
    `Discovery Output:\n${discovery.raw}\n\nOriginal Requirement: ${requirement}`,
    (c) => onProgress?.("workload", c)
  );
  const workloadResponse: AgentResponse = {
    agent: "workload",
    output: workload.output as WorkloadOutput,
    raw: workload.raw,
    completedAt: new Date(),
  };

  // 3. Deployment — inject GPU knowledge base
  const workloadData = workload.output as WorkloadOutput;
  const relevantGpus = getRelevantGpus(workloadData.primary_type, workloadData.model_size_recommendation);
  const gpuContext = formatGpuContext(relevantGpus);

  onProgress?.("deployment", "");
  const deployment = await runAgent(
    "deployment",
    `Requirement: ${requirement}\n\nWorkload: ${workload.raw}\n\nGPU Options:\n${gpuContext}`,
    (c) => onProgress?.("deployment", c)
  );
  const deploymentResponse: AgentResponse = {
    agent: "deployment",
    output: deployment.output as DeploymentOutput,
    raw: deployment.raw,
    completedAt: new Date(),
  };

  // 4. TCO
  onProgress?.("tco", "");
  const tco = await runAgent(
    "tco",
    `Requirement: ${requirement}\n\nWorkload: ${workload.raw}\n\nDeployment: ${deployment.raw}`,
    (c) => onProgress?.("tco", c)
  );
  const tcoResponse: AgentResponse = {
    agent: "tco",
    output: tco.output as TcoOutput,
    raw: tco.raw,
    completedAt: new Date(),
  };

  return {
    discovery: discoveryResponse,
    workload: workloadResponse,
    deployment: deploymentResponse,
    tco: tcoResponse,
  };
}
