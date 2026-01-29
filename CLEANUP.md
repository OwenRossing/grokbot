# Bot Efficiency Cleanup Ideas

## Media & Model Usage
- Skip frame extraction when the user question is purely textual and does not reference the media.
- Cache resolved media URLs and extraction results in-memory with a short TTL to avoid repeat fetches.
- Cap total media inputs per request and log when truncation happens to spot abuse or overuse.

## Prompt Construction
- Trim recent context when the prompt is short and no media is present.
- Avoid re-sending channel/server summaries when unchanged; only refresh periodically.
- Collapse repeated system messages into a single "context bundle" to reduce tokens.

## Memory & Database
- Defer memory writes for very short messages (e.g., "lol", "ok") unless media is attached.
- Batch memory writes with a short debounce window to reduce SQLite churn.
- Purge per-user message history older than N days or above a message cap.

## Handlers & Routing
- Short-circuit intent routing before building heavy context payloads.
- Track model fallbacks and surface a warning only once per session to reduce noisy logs.
- Consolidate media detection into one pass per message to avoid duplicated scans.

## Error & Rate Handling
- Cache failed media fetches briefly to prevent retry storms on bad URLs.
- Back off LLM retries on repeated failures in a short window.
- Add a low-cost "busy" reply when the bot is rate-limited, skipping all context work.

## Operational
- Ensure `tmp/` is routinely cleared on startup or after each media conversion session.
- Validate required env vars at startup and fail fast with a concise error list.
- Add lightweight metrics (counts per command, per media type) to spot hotspots.
