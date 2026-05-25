enum SelfDomain {
  IDENTITY      @description("Core sense of self — who the person fundamentally is")
  CAPABILITY    @description("What they can or cannot do; strengths and limitations")
  VALUE         @description("What matters most to them; moral or personal principles")
  RELATIONAL    @description("How they see themselves in relation to others — roles they hold, not facts about other people")
  ASPIRATIONAL  @description("Who they want to become; what they are working toward")
}

enum Polarity {
  POSITIVE  @description("The user frames this self-perception positively or with pride")
  NEGATIVE  @description("The user frames this self-perception as a limitation, loss, or concern")
  NEUTRAL   @description("The user states this about themselves without clear positive or negative charge")
}

enum AffectiveCharge {
  DISTRESS      @description("Belief held with anxiety, pain, or fear")
  DEFIANT       @description("Belief held as identity assertion or resistance to challenge")
  RESIGNED      @description("Belief held with reluctant acceptance of an unwanted reality")
  NEUTRAL       @description("Belief stated as matter-of-fact with no detectable emotional charge")
  ENTHUSIASTIC  @description("Belief held with pride, excitement, or energy")
}

class TurnPair {
  turn_index        int     @description("Sequential index within the conversation, starting at 0")
  preceding_context string? @description("StoryBot's question (conversations) or thread OP text (discussion comments); null for user-initiated turns")
  user_message      string  @description("The user's message text")
  prompted          bool    @description("True if a direct StoryBot question immediately preceded this message")
}

class ExtractedBelief {
  belief_text      string     @description("A clean, concise statement of the self-belief in the user's own voice. Must be a first-person claim about the self, not about an external subject.")
  belief_type      string     @description("explicit if directly stated by the user, implicit if reasonably inferred from what they said")
  self_domain      SelfDomain
  polarity         Polarity
  temporal_scope   string?    @description("habitual | permanent | situational | general")
  claim_commitment float      @description("All beliefs, 0-1. How strongly/committedly the speaker presents this self-belief as fixed. Copula frames ('I am X', 'I've always been X') near 1.0; preference/hedged frames ('I tend to', 'I suppose I') near 0.2.")
  crystallization  float      @description("All beliefs, 0-1. Openness to revision. 'That's just who I am' → 1.0; 'I'm still figuring this out' → 0.0; actively questioning ('lately I've been rethinking') → below 0.3. Score revision-openness markers, not assertion strength — these are distinct.")
  affective_charge AffectiveCharge? @description("Emotional charge when surface evidence is present. Null if insufficient evidence — do not guess. Score only from explicit emotional markers.")
  source_turn_indices int[]  @description("Which turn_index values this belief comes from; may span multiple turns")
  evidence_spans   string[]   @description("Exact quotes from user messages that support this belief")
  depth_markers    string[]   @description("Specific words or phrases that drove the claim_commitment and crystallization scores")
}

class BeliefExtractionResult {
  beliefs ExtractedBelief[]
}
