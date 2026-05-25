// Mirrored from app/models/output.py and app/models/input.py

export type SelfDomain = "identity" | "capability" | "value" | "relational" | "aspirational";
export type Polarity = "positive" | "negative" | "neutral";
export type AffectiveCharge = "distress" | "defiant" | "resigned" | "neutral" | "enthusiastic";
export type BeliefState = "crystallized" | "transitioning";
export type Delta = "new" | "reinforced" | "contradicted" | "unchanged";
export type SourceType = "conversation" | "discussion";
export type ViewMode = "full" | "storybot" | "recommendation";

export interface SourceEvidence {
  ref_conversation_id: number | null;
  turn_index: number | null;
  transaction_datetime_utc: string | null;
  post_id: number | null;
  comment_id: number | null;
}

export interface BeliefObject {
  belief_id: string;
  belief_text: string;
  belief_type: "explicit" | "implicit";
  self_domain: SelfDomain;
  polarity: Polarity;
  temporal_scope: string | null;
  confidence: number;
  session_weight: number;
  source_evidence: SourceEvidence[];
  claim_commitment: number;
  crystallization: number;
  affective_charge: AffectiveCharge | null;
  belief_state: BeliefState;
  delta: Delta;
  nli_confidence: number;
  evidence_span: string;
  depth_markers: string[];
}

export interface DomainSummary {
  domain: SelfDomain;
  belief_count: number;
  avg_commitment: number;
  avg_crystallization: number;
}

export interface Signal {
  richness_score: number;
  belief_count: number;
  high_confidence_count: number;
  dominant_self_domain: SelfDomain | null;
  beliefs_by_domain: Record<string, number>;
  domain_summaries: DomainSummary[];
}

export interface DataQuality {
  turn_count: number;
  viable: boolean;
  confidence_adjustment: number;
  viable_threshold: number;
}

export interface EvaluationResponse {
  schema_version: string;
  source_type: SourceType;
  ref_conversation_id: number | null;
  post_id: number | null;
  ref_user_id: number;
  processing_mode: string;
  extraction_method: string;
  data_quality: DataQuality;
  signal: Signal;
  beliefs: BeliefObject[];
}

// Data browser types (built from data/*.json)

export interface ConversationTurn {
  ref_conversation_id: number;
  ref_user_id: number;
  transaction_datetime_utc: string;
  screen_name: string;
  message: string;
}

export interface DiscussionTurn {
  author_ref_user_id: number;
  post_id: number;
  comment_id: number | null;
  text: string;
  reported_or_removed: boolean;
}

export interface ConversationSummary {
  id: string; // "conv-{ref_conversation_id}-{ref_user_id}"
  source_type: "conversation";
  ref_conversation_id: number;
  ref_user_id: number;
  screen_name: string;
  turn_count: number;
  first_turn_at: string;
  turns: ConversationTurn[];
}

export interface DiscussionSummary {
  id: string; // "disc-{post_id}-{ref_user_id}"
  source_type: "discussion";
  post_id: number;
  ref_user_id: number;
  turn_count: number;
  turns: DiscussionTurn[];
}

export type SourceSummary = ConversationSummary | DiscussionSummary;

export interface UserEntry {
  ref_user_id: number;
  screen_name: string | null;
  sources: SourceSummary[];
}

export interface DataIndex {
  users: UserEntry[];
}
