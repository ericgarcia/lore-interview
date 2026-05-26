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

// Belief graph types (RFC 0003)

export type RelationToPrior =
  | "IDENTITY"
  | "SUBSUMPTION"
  | "CONTRACTION"
  | "REVISION"
  | "CONTRACTION_OR_REVISION"
  | "ELABORATION"
  | "EXPANSION";

export interface BeliefEvent {
  id: string;
  canonical_id: string;
  belief_text: string;
  subject_tag: string;
  self_domain: string;
  polarity: string;
  claim_commitment: number;
  crystallization: number;
  affective_charge: string | null;
  belief_state: string;
  depth_markers: string; // JSON array
  source_turns: string; // JSON array
  relation_to_prior: RelationToPrior | null;
  related_to_canonical_id: string | null;
  match_confidence: number | null;
  relation_confidence: number | null;
  relation_classifier_flags: string | null; // JSON object
  valid_from: string;
  valid_until: string | null;
  recorded_at: string;
}

export interface BeliefLineage {
  canonical_id: string;
  current: BeliefEvent | null;
  events: BeliefEvent[];
}

export interface UserBeliefsResponse {
  user_id: string;
  lineages: BeliefLineage[];
}

// NLI rejection QA types

export type RejectionReason = "no_evidence" | "low_commitment" | "nli_threshold";

export interface RejectedBelief {
  id: string;
  rejection_reason: RejectionReason;
  belief_text: string;
  belief_type: "explicit" | "implicit";
  subject_tag: string;
  self_domain: string;
  polarity: string;
  claim_commitment: number;
  crystallization: number;
  affective_charge: string | null;
  evidence_spans: string[];
  depth_markers: string[];
  nli_premise: string | null;
  nli_score: number | null;
  nli_threshold: number | null;
}

export interface RejectedBeliefResponse {
  source_id: string;
  rejected: RejectedBelief[];
}

// Belief category types (RFC 0005)

export interface CategoryAdjacentItem {
  category_id: string;
  label: string;
  similarity: number;
}

export interface CategoryBelief {
  canonical_id: string;
  belief_text: string;
  self_domain: string;
  polarity: string;
  claim_commitment: number;
  crystallization: number;
  affective_charge: string | null;
  belief_state: string;
  valid_from: string;
}

export interface BeliefCategory {
  category_id: string;
  label: string;
  adjacent: CategoryAdjacentItem[];
  beliefs: CategoryBelief[];
}

export interface UserCategoriesResponse {
  user_id: string;
  categories: BeliefCategory[];
}

// Metrics dashboard types (RFC 0004)

export interface MetricsSummary {
  total_evaluations: number;
  avg_latency_ms: number | null;
  p90_latency_ms: number | null;
  avg_tokens_in: number | null;
  avg_tokens_out: number | null;
  total_tokens_in: number;
  total_tokens_out: number;
  avg_llm_retries: number | null;
  avg_richness_score: number | null;
  avg_nli_rejection_rate: number | null;
  viable_rate: number | null;
  beliefs_by_domain: Record<string, number>;
  beliefs_by_polarity: Record<string, number>;
  beliefs_by_affective_charge: Record<string, number>;
  beliefs_by_delta: Record<string, number>;
  beliefs_by_state: Record<string, number>;
  avg_nli_confidence: number | null;
  avg_claim_commitment: number | null;
  avg_crystallization: number | null;
}

export interface MetricsHistoryRow {
  evaluated_at: string;
  source_type: string;
  total_latency_ms: number | null;
  llm_tokens_in: number | null;
  llm_tokens_out: number | null;
  llm_retry_count: number | null;
  richness_score: number | null;
  beliefs_final: number | null;
  nli_rejection_rate: number | null;
  viable: number | null;
}
