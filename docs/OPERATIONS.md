# Operations Guide

## Local Development
- Install dependencies: `npm install`
- Start bot: `npm start`
- Commands are registered automatically on startup.

## Pre-Deployment Checklist
- Confirm required env vars are set.
- Verify bot has required Discord intents and permissions.
- Validate slash commands in a test guild.
- Test core flows: mention reply, `/ask`, `/gif`, polls, memory toggles.
- Test image generation flow and `/image-policy` admin controls.

## Production Controls
### Safety and abuse controls
- Prompt-level moderation and hate-speech checks.
- Per-user cooldown + duplicate message protection.
- Image policy block terms and allow/deny controls.

### Cost and reliability controls
- Image quotas: per-user/day and per-guild/day.
- Global + per-user generation concurrency limits.
- Timeout, retry, and circuit-breaker behavior in image generation service.

## Incident Handling
### Bot fails to start
- Check missing env vars in startup logs.
- Confirm API keys and base URL are valid.

### Image generation failing
- Check provider connectivity and `GROK_IMAGE_MODEL`.
- Review timeout/rate-limit logs.
- If circuit is open, wait for cooldown or lower request volume.

### Command issues
- Restart process to re-register commands.
- Confirm bot has channel and interaction permissions.

## Maintenance
- Keep `README.md`, `docs/PROJECT_DOCUMENTATION.md`, and `.env.example` aligned.
- Review `data.db` growth and retention settings periodically.
- Document policy changes when modifying `config/image-policy.json` or admin overrides.
