# Repository Guidelines

## Project Structure & Module Organization
- Entry point is `src/index.js`; event wiring lives under `src/events`, command routing under `src/commands`, and helper logic in `src/handlers`, `src/services`, and `src/utils`.
- Core behaviors (prompt handling, media/gif/video processing, intent routing, guild cache) are grouped by feature under `src/handlers` and `src/services`.
- Pokemon TCG feature modules live under `src/services/tcg/` and slash handling in `src/commands/tcgHandlers.js`.
- Configuration and prompt assets live at the root and `prompts/` (`.env`, `.env.example`, `prompts/system_prompt.txt`).
- Runtime state is stored in SQLite at `data.db` (via `better-sqlite3`).

## Build, Test, and Development Commands
- `npm install` - install dependencies from `package.json`.
- `npm start` - run the bot with `node src/index.js`, register slash commands, and start event listeners.
- `node src/index.js` - direct start command when debugging with custom Node flags.
- VM deploy target: `/home/grokbot/grokbot` with `grokbot.service` (`sudo systemctl restart grokbot` after pull/install).

## Coding Style & Naming Conventions
- The project uses ESM (`"type": "module"`), so use `import`/`export` and avoid CommonJS patterns.
- Use two-space indentation and prefer modern JavaScript (`const`/`let`, optional chaining, arrow functions).
- Use single quotes unless template literals or escaping makes double quotes clearer.
- Keep function and variable names `camelCase`; keep env var names `UPPER_SNAKE_CASE`.

## Testing Guidelines
- There is no formal test suite yet.
- Validate changes by running `npm start` and exercising mention flows, `/ask`, polls, GIFs, `/memory`, `/search`, and `/tcg` behavior in a test guild.
- Watch startup logs for missing env vars (`DISCORD_TOKEN`, `GROK_BASE_URL`, `GROK_API_KEY`) and command registration issues.
- For TCG, smoke test: `/tcg action:collection_stats`, `/tcg action:inventory`, `/tcg action:open_pack set_code:sv1`, and one trade offer/accept flow.

## Commit & Pull Request Guidelines
- Prefer short, imperative commit subjects (for example: `Add media normalization routing`).
- Keep subjects concise (about 50 characters when possible) and scope each commit to one logical change.
- PRs should include: what changed, how it was tested (commands + Discord flows), config changes, and screenshots/snippets for visible behavior updates.

## Security & Configuration Tips
- Never commit `.env`; use `.env.example` as the template.
- Document permission or memory-policy changes in `prompts/system_prompt.txt` when behavior depends on policy.
- Optional TCG API key: `POKEMONTCG_API_KEY` for higher external API rate limits.

## Current State Notes
- Slash command registration is global + guild scoped on startup for fast command propagation.
- `/memory` uses a single action-based command surface.
- `/tcg` exists with action-based operations; pack reveal is staged animation text updates (not rendered GIF media yet).
