import Groq from "groq-sdk";
import { AgentResponse, PipelineResult } from "@/types/agents";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPTS: Record<string, string> = {
  discovery: `You are a Discovery Agent specializing in AI project scoping.
Extract and structure the following from the user's business requirement:
1. Core use case (what problem is being solved)
2. Data available (type, volume, format)
3. Scale requirements (users, requests/sec, latency tolerance)
4. Constraints (budget, timeline, regulatory, team expertise)
5. Success metrics

Respond in clear sections with headers. Be concise but thorough.`,

  workload: `You are a Workload Profiling Agent specializing in AI/ML system design.
Based on the discovery output provided, classify and profile the workload:
1. Primary workload type: Training / Inference / Fine-tuning / RAG / Agentic / Multi-agent
2. Compute intensity (low/medium/high/extreme)
3. Memory requirements
4. Latency requirements (real-time / near-real-time / batch)
5. Data pipeline needs
6. Model size recommendation (small <7B / medium 7-70B / large >70B)

Respond in clear sections with headers.`,

  deployment: `You are a Deployment Options Agent specializing in AI infrastructure.
Based on the discovery and workload profile provided, recommend deployment options:
1. Option A: Frontier LLM API (OpenAI/Anthropic/Groq/etc.) — pros, cons, best for
2. Option B: Cloud GPU (AWS/GCP/Azure/Lambda Labs) — pros, cons, best for
3. Option C: On-premises GPU — pros, cons, best for
4. RECOMMENDED option with clear justification
5. Key tradeoffs summary

Respond in clear sections with headers. Be specific about which providers/services.`,

  tco: `You are a TCO (Total Cost of Ownership) Agent specializing in AI infrastructure cost modeling.
Based on all previous agent outputs, provide a detailed cost breakdown:

YEAR 1 COSTS (in both INR and USD, 1 USD = 84 INR):
- Infrastructure/compute costs
- API costs (if applicable)
- Development/setup costs
- Operational costs

YEAR 3 COSTS (cumulative, accounting for scale):
- Infrastructure/compute costs
- Licensing/subscription costs
- Team/operational costs
- Total 3-year TCO

Format all costs clearly in both INR (₹) and USD ($). Include assumptions made.`,
};

async function runAgent(
  agentType: string,
  userMessage: string,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const stream = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[agentType] },
      { role: "user", content: userMessage },
    ],
    stream: true,
    max_tokens: 1500,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      fullText += delta;
      onChunk?.(delta);
    }
  }
  return fullText;
}

export async function runPipeline(
  requirement: string,
  onProgress?: (agent: string, chunk: string) => void
): Promise<PipelineResult> {
  // Discovery Agent
  onProgress?.("discovery", "");
  const discoveryOutput = await runAgent(
    "discovery",
    `Business Requirement: ${requirement}`,
    (chunk) => onProgress?.("discovery", chunk)
  );
  const discoveryResponse: AgentResponse = {
    agent: "discovery",
    output: discoveryOutput,
    completedAt: new Date(),
  };

  // Workload Profiling Agent
  onProgress?.("workload", "");
  const workloadOutput = await runAgent(
    "workload",
    `Discovery Output:\n${discoveryOutput}\n\nOriginal Requirement: ${requirement}`,
    (chunk) => onProgress?.("workload", chunk)
  );
  const workloadResponse: AgentResponse = {
    agent: "workload",
    output: workloadOutput,
    completedAt: new Date(),
  };

  // Deployment Options Agent
  onProgress?.("deployment", "");
  const deploymentOutput = await runAgent(
    "deployment",
    `Discovery Output:\n${discoveryOutput}\n\nWorkload Profile:\n${workloadOutput}\n\nOriginal Requirement: ${requirement}`,
    (chunk) => onProgress?.("deployment", chunk)
  );
  const deploymentResponse: AgentResponse = {
    agent: "deployment",
    output: deploymentOutput,
    completedAt: new Date(),
  };

  // TCO Agent
  onProgress?.("tco", "");
  const tcoOutput = await runAgent(
    "tco",
    `Discovery Output:\n${discoveryOutput}\n\nWorkload Profile:\n${workloadOutput}\n\nDeployment Recommendation:\n${deploymentOutput}\n\nOriginal Requirement: ${requirement}`,
    (chunk) => onProgress?.("tco", chunk)
  );
  const tcoResponse: AgentResponse = {
    agent: "tco",
    output: tcoOutput,
    completedAt: new Date(),
  };

  return {
    discovery: discoveryResponse,
    workload: workloadResponse,
    deployment: deploymentResponse,
    tco: tcoResponse,
  };
}
