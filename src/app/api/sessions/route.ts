import { NextRequest } from "next/server";
import { listSessions, getSession } from "@/lib/sessions";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (id) {
    const session = await getSession(id);
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessions = await listSessions();
  return new Response(JSON.stringify(sessions), {
    headers: { "Content-Type": "application/json" },
  });
}
