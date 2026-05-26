import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ user_id: string }> }
): Promise<NextResponse> {
  const { user_id } = await context.params;
  try {
    const upstream = await fetch(`${API_URL}/users/${user_id}/beliefs`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `API error ${upstream.status}`, detail: text },
        { status: upstream.status }
      );
    }
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to reach beliefs API", detail: message },
      { status: 502 }
    );
  }
}
