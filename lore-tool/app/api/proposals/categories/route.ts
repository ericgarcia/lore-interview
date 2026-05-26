import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${API_URL}/proposals/categories`, {
      signal: AbortSignal.timeout(10_000),
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
      { error: "Failed to reach proposals API", detail: message },
      { status: 502 }
    );
  }
}
