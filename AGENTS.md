# Repository Guidelines

## Project Structure & Module Organization
- Entry point is `src/index.js`; event wiring lives under `src/events`, command routing under `src/commands`, and helpers/utilities in `src/utils` (see `handlers/`, `services/`, and `utils/` subfolders for intent-specific logic).
- Bot behaviors like polls, GIF lookups, and memory management are centralized in `src/handlers` and `src/services`, while shared constants and validators live in `src/utils`.
- Configuration and prompts live at the repo root (`.env`, `.env.example`, and `prompts/system_prompt.txt`), and runtime state persists to `data.db` (SQLite via `better-sqlite3`).
- No separate `tests/` directory yet; behavior verification happens through automated scripts (see below) and manual Discord flows.

## Build, Test, and Development Commands
- `npm install` – installs dependencies declared in `package.json` so the bot can compile and talk to Discord/Grok APIs.
- `npm start` – runs `node src/index.js`, registers slash commands automatically, and begins listening for events; use this to exercise any feature (polls, `/ask`, `/gif`).
- `node src/index.js` – equivalent to `npm start`; handy when you need to pass extra Node flags or debugging hooks.

## Coding Style & Naming Conventions
- Project uses ESM modules (`"type": "module"`), so prefer `import`/`export` over CommonJS and keep top-level `await` out of entry files.
- Indent with two spaces, favor modern syntax (`const/let`, arrow functions, optional chaining) and single quotes for strings unless interpolation or template literals demand double quotes.
- Handlers, services, and commands adopt `camelCase` function names; folder names mirror the feature (e.g., `handlePrompt`, `gifProcessor`) to keep routing predictable.
- Keep configuration keyed to uppercase snake case in `.env` (e.g., `GROK_API_KEY`), then map those values into lowercase/`camelCase` config objects before exporting.

## Testing Guidelines
- There is no formal test suite; validate changes by running `npm start` and exercising command flows (slash commands, mentions, polls) in a Discord guild or DM.
- Pay attention to console logs/errors during startup—missing env vars immediately halt the process—so confirm `DISCORD_TOKEN`, `GROK_BASE_URL`, and `GROK_API_KEY` exist before testing.
- When adding new behavior, briefly document manual steps (commands used, expected output) either in PR description or a follow-up issue so reviewers can reproduce.

## Commit & Pull Request Guidelines
- Commit messages follow an imperative, descriptive style (e.g., `Add lobotomize command`, `Reapply GIF handling fixes`). Keep the subject line short (≤50 characters) and mention issues or feature tags when relevant.
- PRs should contain a short summary of what changed, how you tested it (commands run, Discord interactions), and any updated configuration needs (new env vars or database migrations).
- Attach screenshots/console snippets when UI logic or Discord messaging behavior changes in a visible way, and link related issues so automated tracking stays accurate.

## Security & Configuration Tips
- Never commit `.env`; use `.env.example` as the template and copy it to `.env` with secrets filled locally before running the bot.
- The bot enforces channel allowlists and per-user memory toggles; document any adjustments to those guards in `prompts/system_prompt.txt` so future contributors know why certain commands require permissions.
