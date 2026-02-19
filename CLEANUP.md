# Context Drop (VM Handoff)

Updated: 2026-02-19

## Current Production State
- Repo: `OwenRossing/grokbot`
- Branch: `main`
- Deployed host: `grokbot@192.168.0.251`
- Service: `grokbot.service` (systemd)
- Latest deployed commit before this handoff file update: `f68e86f`

## What Was Added Recently
- New `/tcg` command family (single command, `action` field).
- TCG pack open + inventory + trade + admin actions.
- New files:
  - `src/commands/tcgHandlers.js`
  - `src/services/tcg/tcgStore.js`
  - `src/services/tcg/tcgApi.js`
  - `src/services/tcg/packEngine.js`
  - `src/services/tcg/tradeEngine.js`
  - `src/services/tcg/animationEngine.js`
- Routing/registration updates:
  - `src/commands/index.js`
  - `src/handlers/handleInteraction.js`
- Docs/env updates:
  - `.env.example`
  - `README.md`

## TCG Notes
- Uses Pokemon TCG API (`https://api.pokemontcg.io/v2`) with optional `POKEMONTCG_API_KEY`.
- Data is cached into SQLite tables via `tcgStore.js`.
- Pack opening currently uses staged animated text reveal (not rendered GIF media yet).
- Trade flow includes locking + settlement checks + credit reserve/release.
- `/tcg action:admin_rollback_trade` is currently a placeholder response.

## Known Follow-Ups
- Implement real GIF/MP4 pack reveal renderer.
- Implement true trade rollback engine.
- Add test coverage for race conditions and trade settlement edge cases.
- Consider moving legacy unused memory handler exports out of `src/commands/handlers.js`.

## Quick Ops Commands (VM)
- Stop: `sudo systemctl stop grokbot`
- Start: `sudo systemctl start grokbot`
- Status: `sudo systemctl --no-pager --full status grokbot`
- Logs: `journalctl -u grokbot -n 200 --no-pager`
- Deploy:
  - `cd /home/grokbot/grokbot`
  - `git fetch origin`
  - `git checkout main`
  - `git pull --ff-only origin main`
  - `npm ci --omit=dev`
  - `sudo systemctl restart grokbot`

## Sanity Checks After Deploy
- Bot logs show: `Slash commands registered (global + guild).`
- `/tcg` appears in slash commands.
- Test:
  - `/tcg action:collection_stats`
  - `/tcg action:inventory`
  - `/tcg action:open_pack set_code:sv1`
