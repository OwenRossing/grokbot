# GrokBot Discord Assistant

A production-ready Discord bot built with **discord.js v14** and Grok (OpenAI-compatible) chat completions. It supports mentions, slash commands, DMs, per-user memory, and strong anti-abuse controls.

## Features
- Mention-based responses using `@BotName` (replies with visible references).
- `/ask` slash command for the same behavior.
- DM support (no mention required).
- Per-user memory with opt-in/out controls.
- Channel allowlist for memory writes in guilds.
- Per-user cooldown and duplicate spam guard.
- Message edit handling with re-runs (60s window, throttled).
- Image support (attachments, embeds, and image URLs) with vision model routing.
- Polls via reactions with auto-close and results.
- Giphy GIF search with `/gif`.
- Prediction markets (paper trading): browse, buy, portfolio, leaderboard, achievements.
- Admin command to purge bot messages from channels with flexible timeframes.

## Setup

### 1) Install dependencies
```bash
npm install
```

### 2) Configure environment
Copy `.env.example` to `.env` and fill it out:
```bash
cp .env.example .env
```

Security note:
- Never commit `.env`.
- Keep secrets only in local `.env` (developer machines) or CI secret stores.
- Run `npm run check:secrets` before pushing to ensure `.env` is not tracked.

Required vars:
- `DISCORD_TOKEN`
- `GROK_API_KEY`
- `GROK_BASE_URL` (recommended: `https://api.x.ai`)

Optional:
- `GROK_MODEL` (default: `grok-4-1-fast-reasoning-latest`)
- `GROK_VISION_MODEL` (optional override used only when images are present)
- `BOT_NAME` (default: `GrokBuddy`)
- `SUPER_ADMIN_USER_ID` (bypasses channel permission checks)
- `GIPHY_API_KEY` (for `/gif` command)
- `POKEMONTCG_API_KEY` (optional key for Pokemon TCG API higher limits)
- `WEB_SEARCH_ENABLED` (`1` to enable automatic web search augmentation)
- `WEB_SEARCH_PROVIDER` (default: `brave`)
- `BRAVE_SEARCH_API_KEY` (required for Brave web search)
- `MEMORY_DEBOUNCE_MS` (default: `1500`)
- `MEMORY_MAX_MESSAGES_PER_USER` (default: `500`)
- `MEMORY_MAX_DAYS` (default: `45`)
- `MEMORY_HYDRATE_MODE` (`full`, `light`, `off`; overrides NODE_ENV behavior)
- `MEMORY_HYDRATE_MEMBER_LIMIT` (default: `1000`)
- `FEATURE_MARKETS_ENABLED` (`1` to enable prediction markets module)
- `KALSHI_API_BASE_URL` (default: `https://api.elections.kalshi.com`)
- `KALSHI_API_KEY` (optional for read-only public market requests)
- `MARKETS_SYNC_MS` (default: `60000`, background sync cadence)
- `PAPER_STARTING_BALANCE` (default: `10000`)
- `MARKETS_TITLE_AI_ENABLED` (`1` enables optional Ollama title polishing; default `0`)
- `MARKETS_TITLE_REFRESH_MS` (default: `21600000`, display-title refresh cadence)
- `OLLAMA_BASE_URL` (default: `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` (default: `qwen2.5:0.5b-instruct`)
- `OLLAMA_TIMEOUT_MS` (default: `1500`)

**AI Intelligence Enhancement Parameters:**
- `LLM_TEMPERATURE` (default: `0.3`) - Controls randomness (0.0-2.0). Lower = more focused, Higher = more creative
- `LLM_TOP_P` (default: `0.9`) - Nucleus sampling (0.0-1.0). Lower = more focused, Higher = more diverse
- `LLM_PRESENCE_PENALTY` (default: `0.1`) - Encourages new topics (-2.0 to 2.0)
- `LLM_FREQUENCY_PENALTY` (default: `0.2`) - Reduces repetition (-2.0 to 2.0)
- `LLM_MAX_TOKENS` (default: `4096`) - Max tokens for completion (higher allows longer, more detailed responses)

### 3) Run
```bash
npm start
npm run dev
```

Slash commands are registered automatically on startup.

## Usage

### Mention-based
In a server channel:
```
@BotName whats good
```

Replying to another message with an image also works:
```
@BotName what is this
```

### Slash command
```
/ask question: whats good
/ask question: whats good ghost:false   (visible to everyone)
/ask question: whats good ghost:true    (visible only to you - default)
/poll question:"Best lunch?" options:"Pizza|Tacos|Sushi" duration:2h
/gif query:"vibes"
/do instruction:"enable memory for #general"
/markets list
/bet buy ticker:... side:yes qty:5
```

The `ghost` parameter controls message visibility:
- `ghost:true` (default) - Only you can see the bot's response (ephemeral message)
- `ghost:false` - Everyone in the channel can see the bot's response


### Memory controls
- `/memory user on` — enable memory
- `/memory user off` — disable memory
- `/memory user view` — view your stored summary
- `/memory user reset` — wipe your own memory
- `/lobotomize` — wipe stored history

### Channel allowlist (guild admins)
Memory starts disabled for all **guild channels**. In allowlisted guild channels, the bot passively records all messages from users who have memory enabled, regardless of whether the bot is mentioned or responds. This provides channel and server context for the bot. Use:
- `/memory channel allow channel:<channel>`
- `/memory channel deny channel:<channel>`
- `/memory channel list`
- `/memory channel reset channel:<channel>`
- `/memory guild scope mode:<allowlist|allow_all_visible>`
- `/memory guild view`
- `/memory guild reset`
- `/memory admin reset-user user:<user>`
- `/status <on|off|view>` (admin, controls ephemeral status sidecar)
- `/do instruction:"set memory scope to allowlist"` (natural-language command gateway)

### Search
- Search is automatic in normal conversation.
- The bot already searches remembered server/channel context when needed.
- Web search is auto-invoked for time-sensitive or factual queries (if `WEB_SEARCH_ENABLED` is not set to `0`).

### Message management (guild admins)
- `/purge <timeframe> <channel>` â€” delete all bot messages in a channel within the specified timeframe (1h, 6h, 12h, 24h, 7d, 30d, or all time)

### DM Support
The bot works fully in DMs with the same memory and conversation features as in guilds:
- Use `/ask` to interact with the bot (the `ghost` parameter has no effect in DMs)
- Direct messages work without needing to mention the bot
- Memory is enabled by default (can be toggled with `/memory user on` and `/memory user off`)
- All conversation history and preferences are preserved

DMs are allowed for memory writes when the user has memory enabled.

### Polls
- Create a poll with mention syntax: reply with `@BotName poll "Question" "A" "B" --duration 2h`
- Or use `/poll question:"..." options:"A|B|C" duration:1d`
- Users vote by reacting with 1ï¸âƒ£ 2ï¸âƒ£ 3ï¸âƒ£ ...
- Bot auto-closes at the deadline and posts results.

### GIFs
- Search Giphy with `/gif query:"cats"` (requires `GIPHY_API_KEY`)

### Prediction Markets (Primary)
- Browse markets: `/markets list`
- View market detail: `/markets view ticker:<ticker>`
- Place paper trade: `/bet buy ticker:<ticker> side:<yes|no> qty:<contracts>`
- View portfolio: `/portfolio [user]`
- View leaderboard: `/leaderboard type:net_worth`
- View achievements: `/achievements [user]`
- Responses include a paper-trading disclaimer (no real money, no financial advice).
- Market titles are cleaned for readability with deterministic rules; optional local Ollama rewrite is best-effort and never required.

### TCG Status
- TCG commands are removed from active runtime and slash registration.
- Prediction markets are now the primary game surface.

### Local Web UI (LAN)
- Enable with `WEB_UI_ENABLED=1`.
- Set auth with `WEB_UI_ADMIN_USER` and either `WEB_UI_ADMIN_PASSWORD_HASH` or `WEB_UI_ADMIN_PASSWORD`.
- Optional host/port: `WEB_UI_HOST` (default `0.0.0.0`) and `WEB_UI_PORT` (default `8787`).
- Includes admin actions to run a markets sync, refresh slash commands, and schedule a soft restart.
- JSON endpoints:
  - `GET /api/summary`
  - `POST /api/admin/sync-markets`
  - `POST /api/admin/refresh-commands`
  - `POST /api/admin/restart`
  - write endpoints require authenticated session + CSRF token.

### Videos
- Reply to a video with `@BotName` or use `/ask` while replying; the bot will acknowledge video context. Advanced transcription is not enabled by default.

## Notes
- The bot stores full user messages **only** from allowlisted channels.
- Responses in non-allowlisted channels are stateless (only the triggering message + reply context).
- A short in-memory window of recent turns plus lightweight user/channel/server summaries are used in allowlisted channels.
- The bot keeps a small cache of known display names per server to make references feel more natural.
- Hate speech and protected-class harassment are blocked before the LLM.

## Data storage
SQLite is used via `better-sqlite3` and stored in `data.db` in the project root.
