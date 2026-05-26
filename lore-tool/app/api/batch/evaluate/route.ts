import { NextRequest, NextResponse } from "next/server";
import type { SourceSummary } from "@/lib/types";
import { sourceToPipelineBody } from "@/app/api/evaluate/route";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { sources } = (await req.json()) as { sources: SourceSummary[] };

  const body = { sources: sources.map(sourceToPipelineBody) };

  try {
    const upstream = await fetch(`${API_URL}/batch/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    return NextResponse.json(data, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to reach evaluation API", detail: message }, { status: 502 });
  }
}
