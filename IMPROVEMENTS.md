# Bot Improvement Ideas

## Memory & Context Layer
- Persist richer per-user memory summaries in `data.db` instead of relying solely on the volatile `inMemoryTurns` map; store recent “topics” and trusted display names so the bot knows who it is talking to even after a restart.  
- Improve the `src/memory.js` flows by tagging conversations with channel intention (DM vs. allowlisted guild) and surfacing that state to handlers so responses can reference prior opt-ins without re-parsing raw mentions.
- When a user is mentioned repeatedly, treat `displayName` updates differently: keep the original user metadata (username + nickname) in memory and use mention text only for the current turn, preventing the bot from assuming a mention is the user’s canonical name.

## System Prompt & Reasoning Guidance
- Rewrite `prompts/system_prompt.txt` to describe the bot’s role (“helpful assistant, remembers high-level user traits, polite in DMs and guilds”) and include explicit instructions about how to combine stored memory with the latest user request.  
- Add a short “context stack” section to the prompt that lists recent system facts (channel type, memory state, last poll result) so that Grok knows what to consider before generating a reply.
- Inject guardrails into the prompt around responding to edits and new media: remind the model to ask clarifying questions if context is insufficient and to mention when it is relying on historical memory versus the current message.

## Observability & User Feedback
- Log contextual signals (`src/utils/helpers.js`) such as whether memory was enabled, which allowlist rule fired, or which model (text vs. vision) handled the request; expose these in a structured log so maintainers can audit why the bot “forgot” something.  
- Surface simple “memory check” replies: after a sequence ends, emit a short summary (either in Discord or logs) of what the bot retained for that user so failures become easier to debug.  
- Build a lightweight “context preview” command (e.g., `/context debug`) that prints the memory blobs the bot intends to reference; reuse the helpers that already format the SQLite rows.

## Next Steps
1. Audit `prompts/system_prompt.txt` and `src/memory.js` to document what state is currently saved and when it is cleared.  
2. Add explicit metadata to memory writes (timestamps, channel type, display name) and update handlers to prefer those fields over new mention text.  
3. Iterate on the system prompt with small tweaks (mentioning stored user traits, clarifying assumptions) and test via `/ask` plus slash commands to confirm the bot feels more “aware.”
