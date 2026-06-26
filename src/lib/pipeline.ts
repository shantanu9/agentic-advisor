import Groq from "groq-sdk";
import {
  AgentResponse, AgentType, PipelineResult,
  DiscoveryOutput, WorkloadOutput, DeploymentOutput, TcoOutput, TcoCost,
} from "@/types/agents";
import { getRelevantGpus, formatGpuContext } from "./gpu-knowledge-base";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 60000 });
const MODEL_PRIMARY  = "llama-3.1-8b-instant";
const MODEL_FALLBACK = "gemma2-9b-it"; // fallback if primary times out

// Model router — upgrade per agent when on paid tier
const MODEL_ROUTER: Record<AgentType, string> = {
  discovery:  MODEL_PRIMARY,
  workload:   MODEL_PRIMARY,
  deployment: MODEL_PRIMARY,
  tco:        MODEL_PRIMARY,
};

const SYSTEM_PROMPTS: Record<AgentType, string> = {
  discovery: `Extract info from the business requirement. Return ONLY a JSON object:
{"use_case":"string","data":{"type":"string","volume":"string","format":"string"},"scale":{"users":"string","requests_per_sec":"string","latency_tolerance":"string"},"constraints":{"budget":"string","timeline":"string","team_size":"string","regulatory":"string"},"success_metrics":["string"]}`,

  workload: `Classify the AI workload. Return ONLY a JSON object:
{"primary_type":"Training|Inference|Fine-tuning|RAG|Agentic|Multi-agent|Mixed","compute_intensity":"Low|Medium|High|Extreme","memory_requirement":"string","latency_class":"Real-time|Near-real-time|Batch","model_size_recommendation":"<7B|7B-70B|>70B","data_pipeline_needed":true,"reasoning":"string"}`,

  deployment: `Recommend deployment options using the GPU specs provided. Return ONLY a JSON object:
{"options":[{"option":"string","provider_examples":["string"],"estimated_cost_usd_month":"string","pros":["string"],"cons":["string"],"best_for":"string"}],"recommended":"string","recommendation_reason":"string","gpu_specs_used":["string"]}`,

  tco: `Calculate TCO. year3_usd = cumulative 3-year total. Return ONLY a JSON object:
{"assumptions":["string"],"costs":[{"category":"string","year1_usd":0,"year3_usd":0}],"total_year1_usd":0,"total_year3_usd":0,"total_year1_inr":0,"total_year3_inr":0,"key_insight":"string"}`,
};

// Pure-code TCO math validator — never trust LLM arithmetic
function validateTco(tco: TcoOutput): TcoOutput {
  const costs: TcoCost[] = (tco.costs ?? []).map((r) => ({
    ...r,
    year1_usd: Math.max(0, Number(r.year1_usd) || 0),
    year3_usd: Math.max(Number(r.year1_usd) || 0, Number(r.year3_usd) || 0),
  }));
  const year1 = costs.reduce((s, r) => s + r.year1_usd, 0);
  const year3 = costs.reduce((s, r) => s + r.year3_usd, 0);
  return {
    ...tco,
    costs,
    total_year1_usd: year1,
    total_year3_usd: year3,
    total_year1_inr: Math.round(year1 * 84),
    total_year3_inr: Math.round(year3 * 84),
  };
}

function safeParseJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw) as T;
}

async function callGroq(model: string, agentType: AgentType, userMessage: string): Promise<string> {
  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[agentType] },
      { role: "user", content: userMessage },
    ],
    stream: false,
    max_tokens: 600,
    temperature: 0.1,
  });
  return response.choices[0]?.message?.content ?? "";
}

async function runAgent(agentType: AgentType, userMessage: string): Promise<string> {
  try {
    return await callGroq(MODEL_ROUTER[agentType], agentType, userMessage);
  } catch (err) {
    console.warn(`Primary model failed for ${agentType}, retrying with fallback:`, String(err));
    return await callGroq(MODEL_FALLBACK, agentType, userMessage);
  }
}

export async function runPipeline(
  requirement: string,
  onProgress?: (agent: AgentType, chunk: string) => void,
  resultsAccumulator?: Partial<PipelineResult>
): Promise<PipelineResult> {
  // 1. Discovery
  onProgress?.("discovery", "");
  const discoveryRaw = await runAgent("discovery", `Requirement: ${requirement}`);
  const discoveryData = safeParseJson<DiscoveryOutput>(discoveryRaw);
  const discoveryResponse: AgentResponse = { agent: "discovery", output: discoveryData, raw: JSON.stringify(discoveryData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.discovery = discoveryResponse;
  onProgress?.("discovery", "__done__");

  // 2. Workload
  onProgress?.("workload", "");
  const workloadRaw = await runAgent("workload", `Requirement: ${requirement}\nDiscovery: ${JSON.stringify(discoveryData)}`);
  const workloadData = safeParseJson<WorkloadOutput>(workloadRaw);
  const workloadResponse: AgentResponse = { agent: "workload", output: workloadData, raw: JSON.stringify(workloadData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.workload = workloadResponse;
  onProgress?.("workload", "__done__");

  // 3. Deployment — inject GPU knowledge base
  const gpuContext = formatGpuContext(getRelevantGpus(workloadData.primary_type, workloadData.model_size_recommendation));
  onProgress?.("deployment", "");
  const deploymentRaw = await runAgent("deployment", `Requirement: ${requirement}\nWorkload: ${JSON.stringify(workloadData)}\nGPU specs:\n${gpuContext}`);
  const deploymentData = safeParseJson<DeploymentOutput>(deploymentRaw);
  const deploymentResponse: AgentResponse = { agent: "deployment", output: deploymentData, raw: JSON.stringify(deploymentData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.deployment = deploymentResponse;
  onProgress?.("deployment", "__done__");

  // 4. TCO — with pure-code math validation
  onProgress?.("tco", "");
  const tcoRaw = await runAgent("tco", `Requirement: ${requirement}\nWorkload: ${JSON.stringify(workloadData)}\nDeployment: ${JSON.stringify(deploymentData)}`);
  const tcoData = validateTco(safeParseJson<TcoOutput>(tcoRaw));
  const tcoResponse: AgentResponse = { agent: "tco", output: tcoData, raw: JSON.stringify(tcoData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.tco = tcoResponse;
  onProgress?.("tco", "__done__");

  return { discovery: discoveryResponse, workload: workloadResponse, deployment: deploymentResponse, tco: tcoResponse };
}
