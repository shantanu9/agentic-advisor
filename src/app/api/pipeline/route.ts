import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { saveSession } from "@/lib/sessions";
import { PipelineResult } from "@/types/agents";

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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let pipelineResult: PipelineResult | null = null;

        pipelineResult = await runPipeline(requirement, (agent, chunk) => {
          if (chunk === "") {
            send({ type: "agent_start", agent });
          } else {
            send({ type: "chunk", agent, chunk });
          }
        });

        // Save to Supabase
        let session = null;
        let saveError = null;
        try {
          session = await saveSession(requirement, pipelineResult);
        } catch (e) {
          saveError = String(e);
        }
        send({ type: "done", sessionId: session?.id ?? null, saveError });
      } catch (err) {
        send({ type: "error", message: String(err) });
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
