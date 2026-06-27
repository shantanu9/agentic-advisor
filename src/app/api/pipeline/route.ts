import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { saveSession } from "@/lib/sessions";
import { saveMetrics, AgentMetrics } from "@/lib/observability";
import { PipelineResult, AgentType } from "@/types/agents";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { requirement } = await req.json();

  if (!requirement || typeof requirement !== "string") {
    return new Response(JSON.stringify({ error: "requirement is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const agentResults: Partial<PipelineResult> = {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      try {
        const { pipeline, metrics } = await runPipeline(
          requirement,
          (agent: AgentType, chunk: string, agentMetric?: AgentMetrics) => {
            if (chunk === "") {
              send({ type: "agent_start", agent });
            } else if (chunk === "__done__") {
              const result = agentResults[agent];
              if (result) send({ type: "agent_done", agent, raw: result.raw, metrics: agentMetric ?? null });
            }
          },
          agentResults
        );

        const result = pipeline as PipelineResult;
        const session = await saveSession(requirement, result).catch(() => null);
        await saveMetrics(session?.id ?? null, metrics).catch(() => null);
        send({ type: "done", sessionId: session?.id ?? null, metrics });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Pipeline error:", msg);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
