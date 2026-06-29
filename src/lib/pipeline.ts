import https from "https";
import {
  AgentStage, IntakeOutput, ClassifierOutput, ModelSelectorOutput,
  SizingOutput, DeploymentTcoOutput, RecommendationOutput,
  StageResult, PipelineResult, ModelSpec,
} from "@/types/agents";
import { runClassifier, deriveModelSizeHintFromClassifier } from "./classifier";
import { retrieveModels, formatModelsForPrompt, getAllModels } from "./model-db";
import { runSizingEngine } from "./sizing-engine";
import { calcCloudTco, calcOnPremTco, calcBreakevenMonth } from "./azure-pricing";
import { AgentMetrics, calcCost, summarizeMetrics, RunMetrics } from "./observability";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL_PRIMARY   = "llama-3.1-8b-instant";
const MODEL_FALLBACK  = "gemma2-9b-it";
const MODEL_FALLBACK2 = "llama-3.3-70b-versatile";

// ── Groq caller — raw https (bypasses Next.js fetch patching) ─────────────────

interface GroqResult { content: string; model: string; input_tokens: number; output_tokens: number; }

function httpsPost(body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 12000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) reject(new Error(`Groq HTTP ${res.statusCode}: ${data}`));
          else resolve(data);
        });
      }
    );
    req.on("timeout", () => { req.destroy(new Error("Request timed out.")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callGroq(systemPrompt: string, userMessage: string): Promise<GroqResult & { latency_ms: number }> {
  const start = Date.now();
  const body = JSON.stringify({
    stream: false, max_tokens: 800, temperature: 0.1,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
  });

  const call = async (model: string) => {
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out.")), 20000)
    );
    const raw = await Promise.race([
      httpsPost(JSON.stringify({ ...JSON.parse(body), model })),
      deadline,
    ]);
    const json = JSON.parse(raw);
    if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      model,
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      latency_ms: Date.now() - start,
    };
  };

  const MODELS = [MODEL_PRIMARY, MODEL_FALLBACK, MODEL_FALLBACK2];
  let lastErr: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await call(model);
      } catch (e) {
        lastErr = e;
        const msg = String(e);
        const isRateLimit = msg.includes("429") || msg.includes("rate") || msg.includes("quota");
        const isTimeout   = msg.includes("timed out") || msg.includes("timeout");
        if (!isRateLimit && !isTimeout) break; // hard error — try next model immediately
        if (attempt < 1) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw lastErr;
}

function sanitizeJson(s: string): string {
  // Strip markdown fences and leading/trailing prose
  s = s.replace(/```(?:json)?/gi, "").replace(/```/g, "");

  // Extract only the JSON object (first { ... } block)
  const firstBrace = s.indexOf("{");
  if (firstBrace > 0) s = s.slice(firstBrace);

  // Replace ALL single-quoted strings with double-quoted equivalents.
  // Walk char-by-char to avoid replacing apostrophes inside double-quoted strings.
  let out = "";
  let i = 0;
  let inDouble = false;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && inDouble) { out += ch + (s[i + 1] ?? ""); i += 2; continue; }
    if (ch === '"') { inDouble = !inDouble; out += ch; i++; continue; }
    if (ch === "'" && !inDouble) {
      // Find closing single quote
      let j = i + 1;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === "\\") j++;
        j++;
      }
      const inner = s.slice(i + 1, j).replace(/"/g, '\\"');
      out += '"' + inner + '"';
      i = j + 1;
      continue;
    }
    out += ch; i++;
  }
  s = out;

  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return s.trim();
}

function safeParseJson<T>(raw: string): T {
  const cleaned = sanitizeJson(raw);
  try { return JSON.parse(cleaned) as T; } catch {}
  // Brace-depth extraction on cleaned string
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON in response");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T; }
  }
  throw new Error("Incomplete JSON in response");
}

function stageResult<T>(stage: AgentStage, type: "llm" | "engine", output: T): StageResult<T> {
  return { stage, type, output, raw: JSON.stringify(output, null, 2), completedAt: new Date() };
}

// ── Agent 1: Intake ───────────────────────────────────────────────────────────

const JSON_RULE = "IMPORTANT: Return ONLY a raw JSON object. No markdown, no code fences, no single quotes, no trailing commas. Use double quotes for all keys and string values.\n\n";

const INTAKE_PROMPT = `${JSON_RULE}Extract structured information from the business requirement. Return ONLY a JSON object:
{
  "industry": "string",
  "use_case": "string",
  "primary_goal": "string",
  "user_count": 0,
  "requests_per_user_per_day": 0,
  "concurrent_users": 0,
  "latency_requirement_ms": 0,
  "availability": "standard|high|critical",
  "data_sensitivity": "public|internal|confidential|restricted",
  "compliance": ["PII","PHI","GDPR","HIPAA","SOC2","PCI-DSS","Financial Regulation","Sovereign"],
  "data_sources": ["string"],
  "data_volume_gb": 0,
  "deployment_preference": "cloud|on-prem|hybrid|no-preference",
  "timeline": "string",
  "team_size": "string",
  "budget_usd_month": 0,
  "lifecycle_stage": "poc|pilot|production",
  "input_tokens_per_request": 0,
  "output_tokens_per_request": 0
}
Infer missing numeric values from context. compliance array should only contain items from the given list that apply. If latency not mentioned, infer from context (real-time = 500ms, near-real-time = 2000ms, batch = 30000ms).`;

// ── Agent 2: Model Selector ───────────────────────────────────────────────────

function buildModelSelectorPrompt(retrievedModels: ModelSpec[]): string {
  return `${JSON_RULE}You are an AI infrastructure expert. Select the best model from the retrieved candidates below based on the workload classification and requirements provided.
Return ONLY a JSON object:
{
  "selected_model_id": "string (exact model_id from the list)",
  "ai_technique": "string",
  "precision": "FP16|INT8|INT4",
  "hosting_preference": "string",
  "context_window_valid": true,
  "context_window_warning": "string or null",
  "selection_rationale": "string (2-3 sentences)"
}

Retrieved model candidates:
${formatModelsForPrompt(retrievedModels)}`;
}

// ── Agent 3: Deployment + TCO ──────────────────────────────────────────────────

function buildDeploymentTcoPrompt(
  cloudYear1: number, cloudYear3: number,
  onPremYear1: number, onPremYear3: number,
  costPerMTokenCloud: number, costPerMTokenOnPrem: number,
  breakevenMonth: number | null,
  azureSku: string
): string {
  return `${JSON_RULE}You are an AI infrastructure architect. Based on the sizing and TCO numbers provided, recommend the deployment architecture. Return ONLY a JSON object:
{
  "architecture_type": "string (e.g. Multi-GPU Multi-Node Cluster)",
  "deployment_model": "Public Cloud|On-prem / Private AI-in-a-Box|Hybrid|Edge",
  "cloud_provider": "Azure",
  "cloud_vm_sku": "${azureSku}",
  "cloud_year1_usd": ${cloudYear1},
  "cloud_year3_usd": ${cloudYear3},
  "onprem_year1_usd": ${onPremYear1},
  "onprem_year3_usd": ${onPremYear3},
  "cost_per_1m_tokens_cloud": ${costPerMTokenCloud},
  "cost_per_1m_tokens_onprem": ${costPerMTokenOnPrem},
  "lower_cost_year1": "${cloudYear1 < onPremYear1 ? "Cloud" : "On-prem"}",
  "lower_cost_year3": "${cloudYear3 < onPremYear3 ? "Cloud" : "On-prem"}",
  "breakeven_month": ${breakevenMonth ?? "null"},
  "assumptions": ["string"]
}
The deployment_model should be "On-prem / Private AI-in-a-Box" if data risk is high or compliance requires it, otherwise follow economics.`;
}

// ── Agent 4: Recommendation ───────────────────────────────────────────────────

const RECOMMENDATION_PROMPT = `${JSON_RULE}You are a senior AI strategy advisor. Generate the final compliance-adjusted recommendation and executive summary. Return ONLY a JSON object:
{
  "economic_recommendation": "Cloud|On-prem",
  "compliance_override": true,
  "final_recommendation": "Cloud|On-prem / Private AI-in-a-Box|Hybrid",
  "confidence": "High|Medium|Low",
  "confidence_rationale": "string",
  "engagement_type": "Advisory Only|AI Factory Lab POC|AI-in-a-Box Deployment|Managed AI Platform|FinOps Optimization|API-to-Self-Hosted Migration",
  "rationale": "string (3-4 sentences explaining the recommendation)",
  "executive_summary": "string (the template: We recommend [X] for [use_case]. The workload requires [pattern] using [model], requiring [memory]GB across [GPUs] GPUs and [nodes] nodes. Although [lower_cost_option] is lower cost over 3 years, [final_rec] is recommended due to [compliance/data_risk].)",
  "risks": ["string"],
  "next_steps": ["string"]
}
If compliance is PII/PHI/HIPAA/Financial Regulation/Sovereign, override to On-prem even if cloud is cheaper. Set compliance_override: true in that case.`;

// ── Progress callback ─────────────────────────────────────────────────────────

export type ProgressCallback = (
  stage: AgentStage,
  event: "start" | "done",
  metrics?: AgentMetrics
) => void;

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runPipeline(
  requirement: string,
  onProgress?: ProgressCallback
): Promise<{ pipeline: PipelineResult; metrics: RunMetrics }> {
  const agentMetrics: AgentMetrics[] = [];

  // ── Stage 1: Intake Agent (LLM) ───────────────────────────────────────────
  onProgress?.("intake", "start");
  const intakeCall = await callGroq(INTAKE_PROMPT, `Business requirement: ${requirement}`);
  const intakeOutput = safeParseJson<IntakeOutput>(intakeCall.content);
  const intakeMetric: AgentMetrics = {
    agent: "intake" as AgentStage,
    model: intakeCall.model, latency_ms: intakeCall.latency_ms,
    input_tokens: intakeCall.input_tokens, output_tokens: intakeCall.output_tokens,
    cost_usd: calcCost(intakeCall.model, intakeCall.input_tokens, intakeCall.output_tokens),
  };
  agentMetrics.push(intakeMetric);
  onProgress?.("intake", "done", intakeMetric);

  // ── Stage 2: Classifier Engine (pure code) ───────────────────────────────
  onProgress?.("classifier", "start");
  const classifierOutput: ClassifierOutput = runClassifier(intakeOutput);
  onProgress?.("classifier", "done");

  // ── Stage 3: Model Selector Agent (LLM + RAG) ────────────────────────────
  onProgress?.("model_selector", "start");
  const modelSizeHint = deriveModelSizeHintFromClassifier(classifierOutput.workload_pattern, intakeOutput.concurrent_users);
  const retrievedModels = retrieveModels(
    classifierOutput.workload_pattern,
    modelSizeHint,
    intakeOutput.compliance
  );
  const modelSelectorSystem = buildModelSelectorPrompt(retrievedModels);
  const modelSelectorUser = `Workload: ${classifierOutput.workload_pattern}
Technique: ${classifierOutput.ai_technique}
Data Risk: ${classifierOutput.data_risk}
Hosting Preference: ${classifierOutput.hosting_preference}
Concurrent Users: ${intakeOutput.concurrent_users}
Total Sequence Length: ${classifierOutput.total_sequence_length} tokens
Compliance: ${intakeOutput.compliance.join(", ") || "None"}
Budget: $${intakeOutput.budget_usd_month}/month`;

  const msCall = await callGroq(modelSelectorSystem, modelSelectorUser);
  const msRaw = safeParseJson<{ selected_model_id: string; ai_technique: string; precision: string; hosting_preference: string; context_window_valid: boolean; context_window_warning?: string; selection_rationale: string }>(msCall.content);

  // Find selected model from retrieved list, fall back to first retrieved
  const selectedModel = retrievedModels.find((m) => m.model_id === msRaw.selected_model_id) ?? retrievedModels[0];
  const modelSelectorOutput: ModelSelectorOutput = {
    retrieved_models: retrievedModels,
    selected_model: selectedModel,
    ai_technique: msRaw.ai_technique,
    precision: msRaw.precision,
    quantization_bytes: selectedModel.quantization_bytes,
    hosting_preference: msRaw.hosting_preference,
    context_window_valid: msRaw.context_window_valid,
    context_window_warning: msRaw.context_window_warning,
    selection_rationale: msRaw.selection_rationale,
  };
  const msMetric: AgentMetrics = {
    agent: "model_selector" as AgentStage,
    model: msCall.model, latency_ms: msCall.latency_ms,
    input_tokens: msCall.input_tokens, output_tokens: msCall.output_tokens,
    cost_usd: calcCost(msCall.model, msCall.input_tokens, msCall.output_tokens),
  };
  agentMetrics.push(msMetric);
  onProgress?.("model_selector", "done", msMetric);

  // ── Stage 4: Sizing Engine (pure code math) ───────────────────────────────
  onProgress?.("sizing", "start");
  const sizingOutput: SizingOutput = runSizingEngine(
    modelSelectorOutput,
    classifierOutput,
    intakeOutput.user_count,
    intakeOutput.requests_per_user_per_day,
    intakeOutput.concurrent_users
  );
  onProgress?.("sizing", "done");

  // ── Stage 5: Deployment + TCO Agent (LLM + reference cost tables) ───────────
  onProgress?.("deployment_tco", "start");

  const cloudPaygCalc = calcCloudTco(sizingOutput.nodes_required, "payg");
  const cloudCalc     = calcCloudTco(sizingOutput.nodes_required, "1yr");
  const cloud3yrCalc  = calcCloudTco(sizingOutput.nodes_required, "3yr");
  const onPremCalc    = calcOnPremTco(sizingOutput.nodes_required);

  const cloudYear1   = cloudCalc.total_year1;
  const cloudYear3   = cloudCalc.total_year3;
  const onPremYear1  = onPremCalc.total_year1;
  const onPremYear3  = onPremCalc.total_year3;

  const costPerMCloud  = sizingOutput.annual_token_volume > 0 ? (cloudYear1  / sizingOutput.annual_token_volume) * 1_000_000 : 0;
  const costPerMOnPrem = sizingOutput.annual_token_volume > 0 ? (onPremYear1 / sizingOutput.annual_token_volume) * 1_000_000 : 0;
  const breakevenMonth = calcBreakevenMonth(cloudYear1, onPremYear1, onPremYear3);

  const dtcoSystem = buildDeploymentTcoPrompt(cloudYear1, cloudYear3, onPremYear1, onPremYear3, Math.round(costPerMCloud * 100) / 100, Math.round(costPerMOnPrem * 100) / 100, breakevenMonth, "Standard_ND96isr_H100_v5");
  const dtcoUser = `Workload: ${classifierOutput.workload_pattern}
Data Risk: ${classifierOutput.data_risk}
Compliance: ${intakeOutput.compliance.join(", ") || "None"}
Deployment Classification: ${sizingOutput.deployment_classification}
GPUs Required: ${sizingOutput.gpus_required} × ${sizingOutput.gpu_model}
Nodes: ${sizingOutput.nodes_required}
Total Memory: ${sizingOutput.total_gpu_memory_gb} GB
Annual Token Volume: ${sizingOutput.annual_token_volume.toLocaleString()}
Cloud Term: 1-year reserved @ $63.01/hr per node
Cloud GPU cost (1yr): $${cloudCalc.gpu_year1.toLocaleString()}
Cloud Services cost (1yr): $${cloudCalc.services_year1.toLocaleString()}
On-Prem CapEx (yr1): $${(onPremCalc.capex_year1).toLocaleString()}
On-Prem Annual OpEx: $${onPremCalc.opex_year1.toLocaleString()}
On-Prem NVAIE (yr1): $${onPremCalc.nvaie_year1.toLocaleString()}`;

  const dtcoCall = await callGroq(dtcoSystem, dtcoUser);
  const dtcoRaw = safeParseJson<DeploymentTcoOutput>(dtcoCall.content);

  // Always trust our calculated numbers over LLM-generated numbers
  const deploymentTcoOutput: DeploymentTcoOutput = {
    ...dtcoRaw,
    cloud_year1_usd:           cloudYear1,
    cloud_year3_usd:           cloudYear3,
    cloud_payg_year1_usd:      cloudPaygCalc.total_year1,
    cloud_payg_year3_usd:      cloudPaygCalc.total_year3,
    cloud_3yr_year1_usd:       cloud3yrCalc.total_year1,
    cloud_3yr_total_usd:       cloud3yrCalc.total_year3,
    onprem_year1_usd:          onPremYear1,
    onprem_year3_usd:          onPremYear3,
    cost_per_1m_tokens_cloud:  Math.round(costPerMCloud  * 100) / 100,
    cost_per_1m_tokens_onprem: Math.round(costPerMOnPrem * 100) / 100,
    lower_cost_year1:          cloudYear1 < onPremYear1 ? "Cloud" : "On-prem",
    lower_cost_year3:          cloudYear3 < onPremYear3 ? "Cloud" : "On-prem",
    breakeven_month:           breakevenMonth,
    cloud_cost_rows_payg:      cloudPaygCalc.cost_rows,
    cloud_cost_rows_1yr:       cloudCalc.cost_rows,
    cloud_cost_rows_3yr:       cloud3yrCalc.cost_rows,
    onprem_cost_rows:          onPremCalc.cost_rows,
    cost_rows:                 onPremCalc.cost_rows,
  };
  const dtcoMetric: AgentMetrics = {
    agent: "deployment_tco" as AgentStage,
    model: dtcoCall.model, latency_ms: dtcoCall.latency_ms,
    input_tokens: dtcoCall.input_tokens, output_tokens: dtcoCall.output_tokens,
    cost_usd: calcCost(dtcoCall.model, dtcoCall.input_tokens, dtcoCall.output_tokens),
  };
  agentMetrics.push(dtcoMetric);
  onProgress?.("deployment_tco", "done", dtcoMetric);

  // ── Stage 6: Recommendation Agent (LLM) ──────────────────────────────────
  onProgress?.("recommendation", "start");
  const recUser = `Use Case: ${intakeOutput.use_case}
Industry: ${intakeOutput.industry}
Workload Pattern: ${classifierOutput.workload_pattern}
Selected Model: ${modelSelectorOutput.selected_model.name}
Total GPU Memory: ${sizingOutput.total_gpu_memory_gb} GB
GPUs Required: ${sizingOutput.gpus_required}
Nodes: ${sizingOutput.nodes_required}
Data Risk: ${classifierOutput.data_risk}
Compliance: ${intakeOutput.compliance.join(", ") || "None"}
Cloud 1yr TCO: $${cloudYear1.toLocaleString()}
On-prem 1yr TCO: $${onPremYear1.toLocaleString()}
Cloud 3yr TCO: $${cloudYear3.toLocaleString()}
On-prem 3yr TCO: $${onPremYear3.toLocaleString()}
3yr Lower Cost: ${cloudYear3 < onPremYear3 ? "Cloud" : "On-prem"}
Break-even Month: ${breakevenMonth ?? "No break-even within 36 months"}
Deployment Model: ${deploymentTcoOutput.deployment_model}`;

  const recCall = await callGroq(RECOMMENDATION_PROMPT, recUser);
  const recommendationOutput = safeParseJson<RecommendationOutput>(recCall.content);
  const recMetric: AgentMetrics = {
    agent: "recommendation" as AgentStage,
    model: recCall.model, latency_ms: recCall.latency_ms,
    input_tokens: recCall.input_tokens, output_tokens: recCall.output_tokens,
    cost_usd: calcCost(recCall.model, recCall.input_tokens, recCall.output_tokens),
  };
  agentMetrics.push(recMetric);
  onProgress?.("recommendation", "done", recMetric);

  const pipeline: PipelineResult = {
    intake:         stageResult("intake",         "llm",    intakeOutput),
    classifier:     stageResult("classifier",     "engine", classifierOutput),
    model_selector: stageResult("model_selector", "llm",    modelSelectorOutput),
    sizing:         stageResult("sizing",         "engine", sizingOutput),
    deployment_tco: stageResult("deployment_tco", "llm",    deploymentTcoOutput),
    recommendation: stageResult("recommendation", "llm",    recommendationOutput),
  };

  return { pipeline, metrics: summarizeMetrics(agentMetrics) };
}
