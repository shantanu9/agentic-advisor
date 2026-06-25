// Placeholder — primary pipeline is handled by /api/pipeline/route.ts
export async function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
}
