import Groq from "groq-sdk";
import {
  AgentResponse, AgentType, PipelineResult,
  DiscoveryOutput, WorkloadOutput, DeploymentOutput, TcoOutput, TcoCost,
} from "@/types/agents";
import { getRelevantGpus, formatGpuContext } from "./gpu-knowledge-base";
import { AgentMetrics, calcCost, summarizeMetrics, RunMetrics } from "./observability";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 60000 });
const MODEL_PRIMARY  = "llama-3.1-8b-instant";
const MODEL_FALLBACK = "gemma2-9b-it";

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

function validateTco(tco: TcoOutput): TcoOutput {
  const costs: TcoCost[] = (tco.costs ?? []).map((r) => ({
    ...r,
    year1_usd: Math.max(0, Number(r.year1_usd) || 0),
    year3_usd: Math.max(Number(r.year1_usd) || 0, Number(r.year3_usd) || 0),
  }));
  const year1 = costs.reduce((s, r) => s + r.year1_usd, 0);
  const year3 = costs.reduce((s, r) => s + r.year3_usd, 0);
  return {
    ...tco, costs,
    total_year1_usd: year1,
    total_year3_usd: year3,
    total_year1_inr: Math.round(year1 * 84),
    total_year3_inr: Math.round(year3 * 84),
  };
}

function safeParseJson<T>(raw: string): T {
  try { return JSON.parse(raw) as T; } catch {}

  const start = raw.indexOf("{");
  if (start === -1) throw new Error("No JSON object in response");

  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(raw.slice(start, i + 1)) as T; }
  }
  throw new Error("No complete JSON object found in response");
}

interface GroqResult { content: string; model: string; input_tokens: number; output_tokens: number; }

async function callGroq(model: string, agentType: AgentType, userMessage: string): Promise<GroqResult> {
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
  return {
    content: response.choices[0]?.message?.content ?? "",
    model,
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
  };
}

async function runAgent(agentType: AgentType, userMessage: string): Promise<{ result: GroqResult; latency_ms: number }> {
  const start = Date.now();
  try {
    const result = await callGroq(MODEL_ROUTER[agentType], agentType, userMessage);
    return { result, latency_ms: Date.now() - start };
  } catch (err) {
    console.warn(`Primary model failed for ${agentType}, retrying with fallback:`, String(err));
    const result = await callGroq(MODEL_FALLBACK, agentType, userMessage);
    return { result, latency_ms: Date.now() - start };
  }
}

export async function runPipeline(
  requirement: string,
  onProgress?: (agent: AgentType, chunk: string, agentMetric?: AgentMetrics) => void,
  resultsAccumulator?: Partial<PipelineResult>
): Promise<{ pipeline: PipelineResult; metrics: RunMetrics }> {
  const agentMetrics: AgentMetrics[] = [];

  // 1. Discovery
  onProgress?.("discovery", "");
  const { result: dr, latency_ms: dl } = await runAgent("discovery", `Requirement: ${requirement}`);
  const discoveryData = safeParseJson<DiscoveryOutput>(dr.content);
  const dm: AgentMetrics = { agent: "discovery", model: dr.model, latency_ms: dl, input_tokens: dr.input_tokens, output_tokens: dr.output_tokens, cost_usd: calcCost(dr.model, dr.input_tokens, dr.output_tokens) };
  agentMetrics.push(dm);
  const discoveryResponse: AgentResponse = { agent: "discovery", output: discoveryData, raw: JSON.stringify(discoveryData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.discovery = discoveryResponse;
  onProgress?.("discovery", "__done__", dm);

  // 2. Workload
  onProgress?.("workload", "");
  const { result: wr, latency_ms: wl } = await runAgent("workload", `Requirement: ${requirement}\nDiscovery: ${JSON.stringify(discoveryData)}`);
  const workloadData = safeParseJson<WorkloadOutput>(wr.content);
  const wm: AgentMetrics = { agent: "workload", model: wr.model, latency_ms: wl, input_tokens: wr.input_tokens, output_tokens: wr.output_tokens, cost_usd: calcCost(wr.model, wr.input_tokens, wr.output_tokens) };
  agentMetrics.push(wm);
  const workloadResponse: AgentResponse = { agent: "workload", output: workloadData, raw: JSON.stringify(workloadData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.workload = workloadResponse;
  onProgress?.("workload", "__done__", wm);

  // 3. Deployment — inject GPU knowledge base
  const gpuContext = formatGpuContext(getRelevantGpus(workloadData.primary_type, workloadData.model_size_recommendation));
  onProgress?.("deployment", "");
  const { result: depr, latency_ms: depl } = await runAgent("deployment", `Requirement: ${requirement}\nWorkload: ${JSON.stringify(workloadData)}\nGPU specs:\n${gpuContext}`);
  const deploymentData = safeParseJson<DeploymentOutput>(depr.content);
  const depm: AgentMetrics = { agent: "deployment", model: depr.model, latency_ms: depl, input_tokens: depr.input_tokens, output_tokens: depr.output_tokens, cost_usd: calcCost(depr.model, depr.input_tokens, depr.output_tokens) };
  agentMetrics.push(depm);
  const deploymentResponse: AgentResponse = { agent: "deployment", output: deploymentData, raw: JSON.stringify(deploymentData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.deployment = deploymentResponse;
  onProgress?.("deployment", "__done__", depm);

  // 4. TCO — with pure-code math validation
  onProgress?.("tco", "");
  const { result: tcor, latency_ms: tcol } = await runAgent("tco", `Requirement: ${requirement}\nWorkload: ${JSON.stringify(workloadData)}\nDeployment: ${JSON.stringify(deploymentData)}`);
  const tcoData = validateTco(safeParseJson<TcoOutput>(tcor.content));
  const tcom: AgentMetrics = { agent: "tco", model: tcor.model, latency_ms: tcol, input_tokens: tcor.input_tokens, output_tokens: tcor.output_tokens, cost_usd: calcCost(tcor.model, tcor.input_tokens, tcor.output_tokens) };
  agentMetrics.push(tcom);
  const tcoResponse: AgentResponse = { agent: "tco", output: tcoData, raw: JSON.stringify(tcoData, null, 2), completedAt: new Date() };
  if (resultsAccumulator) resultsAccumulator.tco = tcoResponse;
  onProgress?.("tco", "__done__", tcom);

  const pipeline = { discovery: discoveryResponse, workload: workloadResponse, deployment: deploymentResponse, tco: tcoResponse };
  const metrics = summarizeMetrics(agentMetrics);
  return { pipeline, metrics };
}
