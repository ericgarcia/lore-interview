import { NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  const upstream = await fetch(`${API_URL}/batch/${id}/progress`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Batch run not found", { status: 404 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
