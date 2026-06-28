import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { saveSession } from "@/lib/sessions";
import { saveMetrics, AgentMetrics } from "@/lib/observability";
import { AgentStage, PipelineResult } from "@/types/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { requirement } = await req.json();

  if (!requirement || typeof requirement !== "string") {
    return new Response(JSON.stringify({ error: "requirement is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stageOutputs: Partial<Record<AgentStage, string>> = {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };

      try {
        const { pipeline, metrics } = await runPipeline(
          requirement,
          (stage: AgentStage, event: "start" | "done", metric?: AgentMetrics) => {
            if (event === "start") {
              send({ type: "stage_start", stage });
            } else {
              send({ type: "stage_done", stage, raw: stageOutputs[stage] ?? "", metrics: metric ?? null });
            }
          }
        );

        // Populate stage outputs after pipeline completes for session saving
        (Object.keys(pipeline) as AgentStage[]).forEach((k) => {
          stageOutputs[k] = (pipeline as PipelineResult)[k]?.raw ?? "";
        });

        const session = await saveSession(requirement, pipeline).catch(() => null);
        await saveMetrics(session?.id ?? null, metrics).catch(() => null);
        send({ type: "done", sessionId: session?.id ?? null, metrics, pipeline });
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
