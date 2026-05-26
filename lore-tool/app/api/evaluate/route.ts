import { NextRequest, NextResponse } from "next/server";
import type { ConversationSummary, DiscussionSummary } from "@/lib/types";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export function sourceToPipelineBody(source: ConversationSummary | DiscussionSummary): object {
  if (source.source_type === "conversation") {
    const s = source as ConversationSummary;
    return {
      source_type: "conversation",
      ref_conversation_id: s.ref_conversation_id,
      ref_user_id: s.ref_user_id,
      session_number: 1,
      prior_belief_ids: [],
      turns: s.turns,
    };
  } else {
    const s = source as DiscussionSummary;
    return {
      source_type: "discussion",
      post_id: s.post_id,
      ref_user_id: s.ref_user_id,
      prior_belief_ids: [],
      turns: s.turns,
    };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { source } = (await req.json()) as {
    source: ConversationSummary | DiscussionSummary;
  };

  const body = sourceToPipelineBody(source);

  try {
    const upstream = await fetch(
      `${API_URL}/conversations/evaluate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      }
    );

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
    return NextResponse.json({ error: "Failed to reach evaluation API", detail: message }, { status: 502 });
  }
}
