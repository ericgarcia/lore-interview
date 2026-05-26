import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  try {
    const res = await fetch(`${API_URL}/metrics/history?limit=${limit}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `API error ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to reach API", detail: message }, { status: 502 });
  }
}
