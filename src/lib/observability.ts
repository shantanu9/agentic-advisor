import { supabaseAdmin } from "./supabase";

export interface AgentMetrics {
  agent: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface RunMetrics {
  agents: AgentMetrics[];
  total_latency_ms: number;
  total_tokens: number;
  total_cost_usd: number;
}

// Groq pricing as of 2025 (per million tokens)
const PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gemma2-9b-it": { input: 0.20, output: 0.20 },
};

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? { input: 0.05, output: 0.08 };
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export async function saveMetrics(sessionId: string | null, metrics: RunMetrics): Promise<void> {
  if (!sessionId) return;
  const rows = metrics.agents.map((m) => ({ session_id: sessionId, ...m }));
  const { error } = await supabaseAdmin.from("metrics").insert(rows);
  if (error) console.error("Failed to save metrics:", error.message);
}

export function summarizeMetrics(agents: AgentMetrics[]): RunMetrics {
  return {
    agents,
    total_latency_ms: agents.reduce((s, a) => s + a.latency_ms, 0),
    total_tokens: agents.reduce((s, a) => s + a.input_tokens + a.output_tokens, 0),
    total_cost_usd: agents.reduce((s, a) => s + a.cost_usd, 0),
  };
}
