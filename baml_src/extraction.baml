function ExtractBeliefs(
  turns: TurnPair[],
  source_type: string @description("conversation | discussion")
) -> BeliefExtractionResult {
  client GeminiFlash

  prompt #"
    You are extracting how a person perceives themselves — their self-concept.
    Extract only self-beliefs from the following
    {% if source_type == "conversation" %}StoryBot conversation{% else %}community discussion{% endif %}.

    A self-belief is a durable perception the user holds about themselves: who they are,
    what they can or cannot do, what they value, how they see their role in relationships,
    or who they aspire to become.

    EXTRACT — beliefs that would still be true next month and reveal how this person sees themselves:
    - Identity claims: "I am X", "I've always been X", "that's just not me"
    - Capability claims: "I can't X anymore", "I'm good at X", "X has gotten harder for me"
    - Value claims: "I care about X", "X matters to me", "I couldn't live without X" — when X is about how they live, not a preference for an object
    - Relational self-concept: "I see myself as someone who X", "I've always been the one who X"
    - Aspirations: "I want to be the kind of person who X", "I'm working toward becoming X"

    DO NOT EXTRACT — these are not self-beliefs:
    - Situational complaints about external things: "this app is hard", "the software keeps crashing"
    - Event descriptions: "I had a fall last week", "I talked to my daughter"
    - Simple object preferences: "I love my garden", "I enjoy my chair" — attachment to objects, not self-concept
    - Facts about current circumstances: "my grandson helps me", "I live alone right now"
    - Opinions about external topics: "remote work is isolating", "AI is changing everything"
    - Transient emotions without self-concept implication: "I'm frustrated today", "this made me sad"

    The test: Does this tell us something enduring about how this person sees themselves?
    If the belief is primarily about an external object, event, or other person — skip it.

    Only extract from user messages. Return an empty beliefs array if no qualifying self-beliefs
    are expressed. A belief may span multiple turns — record all relevant turn_index values.

    Turns marked (unprompted) were volunteered without a direct question — weight these
    slightly higher as freely expressed self-perceptions.

    {% for turn in turns %}
    [Turn {{ turn.turn_index }}{% if not turn.prompted %} · unprompted{% endif %}]
    {% if turn.preceding_context %}
    {% if source_type == "conversation" %}StoryBot{% else %}Thread topic{% endif %}: {{ turn.preceding_context }}
    {% endif %}
    User: {{ turn.user_message }}

    {% endfor %}

    For each self-belief, score:

    claim_commitment (0–1): How strongly does the speaker present this as fixed about themselves?
    Score from assertion strength, NOT from how open they are to change.
    - "I am fundamentally not a morning person" → 0.95
    - "I tend to be fairly introverted" → 0.5
    - "I suppose I'm not really a people person" → 0.2
    - "I guess I worry about being safe alone" → 0.35 (hedged, situational framing)

    crystallization (0–1): How open or closed are they to revising this self-belief?
    Score from revision-openness markers only — this is NOT the same as claim_commitment.
    A person can assert confidently yet signal openness, or hedge yet signal closure.
    - "That's just who I am, always has been" → 0.95
    - "I've always been this way" → 0.85
    - "I'm still figuring out who I am" → 0.05
    - "Lately I've been rethinking that about myself" → 0.2
    - No revision signal present → ~0.5

    affective_charge: Only score when explicit surface markers are present. Null otherwise.
    - DISTRESS: anxiety/fear/pain ("it terrifies me", "I hate that about myself")
    - DEFIANT: resistance/identity assertion ("nothing will change that")
    - RESIGNED: reluctant acceptance ("I suppose", "I've had to accept")
    - NEUTRAL: flat factual self-statement with no emotional inflection
    - ENTHUSIASTIC: pride/excitement/energy ("I love that about myself", "I'm proud of")

    {{ ctx.output_format }}
  "#
}

// ─── Tests ────────────────────────────────────────────────────────────────────
// Real data from data/conversations.json (ref_conversation_id=98696, ref_user_id=782)
// Good self-beliefs: physical decline, helplessness, independence, home attachment, values

test ConversationBeliefs {
  functions [ExtractBeliefs]
  args {
    source_type "conversation"
    turns [
      {
        turn_index 0
        preceding_context null
        user_message "Hello StoryBot, I'm having a tough time with this app. My fingers aren't what they used to be. Can you help me?"
        prompted false
      }
      {
        turn_index 1
        preceding_context "Hello ChattyPenguin! I'm here to help. Can you tell me what issues you're experiencing with the app?"
        user_message "It's just so complicated! I keep hitting the wrong buttons. And sometimes it logs me out unexpectedly."
        prompted true
      }
      {
        turn_index 2
        preceding_context "That sounds frustrating! Unfortunately, I can't fix technical issues directly, but I can guide you on how to navigate it better if you'd like."
        user_message "I'd appreciate that. My grandson usually helps, but he's busy with school lately. I feel so helpless."
        prompted true
      }
      {
        turn_index 5
        preceding_context "I'm sorry to hear that, ChattyPenguin. It's tough to feel unwell. Would you like to share more about what's bothering you?"
        user_message "Well, I had a fall last week, and it shook me up. I remember back in the day, I slipped in the kitchen while baking. I thought I broke my hip then, but I learned to always be careful and mindful. That taught me to value my health and strength."
        prompted true
      }
      {
        turn_index 6
        preceding_context "That's a poignant lesson, ChattyPenguin. Prioritizing safety is always wise. Have you shared your recent concerns with family?"
        user_message "I talked to my daughter about it. She said I should consider moving into assisted living, but I don't want to leave my home."
        prompted true
      }
      {
        turn_index 7
        preceding_context "That's understandable. Your home holds many memories. It's important to feel comfortable where you live. What are your favorite things about your home?"
        user_message "My garden is beautiful, and I love my cozy chair by the window. But, I guess I worry about being safe alone."
        prompted true
      }
      {
        turn_index 8
        preceding_context "It's great that you have a lovely garden to enjoy! Finding ways to make your space safer could ease some worries. Would you like tips on that?"
        user_message "Yes, please! I want to stay here for as long as I can."
        prompted true
      }
    ]
  }
}

// Real data from data/discussions.json (post_id=1131, author_ref_user_id=212)
// User 212 expresses skepticism — test whether the implied self-belief about
// critical thinking gets extracted while the topic opinion does not

test DiscussionBeliefs {
  functions [ExtractBeliefs]
  args {
    source_type "discussion"
    turns [
      {
        turn_index 0
        preceding_context "Hey everyone! I wanted to start a discussion about stress management techniques. With everything going on in the world, it can be really tough to find ways to cope. Personally, I've found mindfulness meditation to be incredibly helpful. What are some techniques you all use to manage stress? Let's share our experiences and perhaps we can all pick up something beneficial!"
        user_message "I completely agree! However, I am a bit skeptical about some wellness trends. Can we trust all these 'quick fixes' for stress? I believe it's essential to understand the root of the issue instead of just masking it. Thoughts?"
        prompted false
      }
    ]
  }
}
