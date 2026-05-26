import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const view = req.nextUrl.searchParams.get("view") ?? "full";
  try {
    const upstream = await fetch(
      `${API_URL}/evaluations/${id}?view=${view}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!upstream.ok) {
      return NextResponse.json({ error: "not_found" }, { status: upstream.status });
    }
    return NextResponse.json(await upstream.json());
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
