Simulate a new StoryBot conversation for a Lore user based on their belief profile and conversation history.

Usage: /simulate-conversation <user_id>

Steps:

1. Call the simulation context API:
   ```
   curl -s http://localhost:8000/users/$ARGUMENTS/simulation-context
   ```
   Parse the JSON response. Note:
   - `screen_name`: the user's display name
   - `beliefs`: current belief profile (pay attention to `belief_state`, `claim_commitment`, `crystallization`, `self_domain`)
   - `categories`: belief cluster labels and sizes
   - `conversations`: prior conversation turns — read these carefully to understand the user's voice, topics already covered, and where they left off

2. Generate a realistic StoryBot conversation as a JSON array with this exact structure:
   ```json
   [
     {
       "ref_conversation_id": <new unique integer, e.g. 99001>,
       "ref_user_id": <user_id as integer>,
       "messages_list": [
         {
           "ref_conversation_id": <same id>,
           "ref_user_id": 1,
           "transaction_datetime_utc": "<ISO datetime, ~6 weeks after last conversation>",
           "screen_name": "StoryBot",
           "message": "<StoryBot opening turn>"
         },
         {
           "ref_conversation_id": <same id>,
           "ref_user_id": <user_id as integer>,
           "transaction_datetime_utc": "<5 minutes after previous turn>",
           "screen_name": "<screen_name>",
           "message": "<user response>"
         }
       ]
     }
   ]
   ```

3. Generation guidelines:
   - Set the conversation ~6 weeks after the most recent prior conversation
   - Write 8–12 user turns. StoryBot asks open, empathetic, reflective questions — it does not lecture
   - Cover at least 2 of the user's existing belief categories; introduce at least one new development or shift
   - **Crystallized beliefs** (`belief_state: "crystallized"`, high `claim_commitment`): user reinforces or slightly deepens them
   - **Transitioning beliefs** (`belief_state: "transitioning"`): allow natural evolution — could resolve or drift further
   - **Polarity**: positive beliefs stay grounded, negative beliefs may soften or deepen depending on context
   - Match the user's established voice and vocabulary from prior conversations
   - Do NOT contradict facts established in the prior conversation turns
   - StoryBot never summarises what it's heard back verbatim — it reflects, asks, and gently probes

4. Write the generated JSON to a file:
   `data/simulated_<user_id>_<YYYYMMDD_HHMMSS>.json`

5. Import the conversation into the database:
   ```
   python scripts/seed_db.py
   ```
   Confirm the seeded turn count increased.

6. Print a summary:
   - File path written
   - Seeded turn count from the import
   - Belief themes the conversation touches on
   - Any new developments or belief shifts introduced
   - Suggested next step: use the Batch Evaluate page to extract beliefs from the new conversation
