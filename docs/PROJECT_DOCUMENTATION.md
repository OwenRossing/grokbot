# Project Documentation

## Overview
GrokBot is a Discord bot built on `discord.js` v14 with Grok-compatible APIs. It supports mention and slash-command interactions, DM conversations, per-user memory, channel-level memory controls, media-aware prompting, polls, GIF search, and production-safe moderation/rate limiting.

## High-Level Architecture
- `src/index.js`: startup, env validation, Discord client bootstrapping.
- `src/events/`: Discord event wiring and command registration.
- `src/commands/`: slash command definitions and handlers.
- `src/handlers/`: message/interaction orchestration and prompt execution.
- `src/services/`: integrations and processors (LLM, media, guild cache, image generation, policy).
- `src/memory.js`: SQLite-backed persistence and lightweight migrations.

## Core Flows
1. Message or interaction arrives.
2. Handler validates permissions/rate limits/moderation.
3. Intent routing handles fast-path intents (owner/member/role/random).
4. Prompt pipeline prepares memory context + media context.
5. Bot calls text/vision/image-generation endpoint and returns result.

## Data Storage
`data.db` (SQLite via `better-sqlite3`) stores:
- User memory/settings and message history.
- Channel/guild summaries and metadata.
- Poll state and tracked bot messages.
- Image generation request logs, quota usage, and policy overrides.

## Image Generation
Image generation is routed from natural language prompts (e.g., `/ask generate a...`).
- Provider integration: `src/services/imageGenerator.js`
- Policy enforcement: `src/services/imagePolicy.js`
- Admin controls: `/image-policy view|set|allow-user|deny-user`
- Responses are sent as Discord file attachments.

## Runtime Configuration
See `.env.example` for all options. Required at minimum:
- `DISCORD_TOKEN`
- `GROK_API_KEY`
- `GROK_BASE_URL`

Policy defaults are in `config/image-policy.json`.
