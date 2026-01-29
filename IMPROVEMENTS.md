# Bot Improvement Ideas: Media Understanding

## Media Intake & Normalization
- Normalize all embeds (image, GIF, video, link previews) into a single `mediaQueue` shape with `type`, `url`, `mime`, `source`, `duration`, and `frameCount` so handlers do not branch on Discord embed flavors.
- Expand the attachment/embeds parser to pull media URLs from message content, embed providers, and attachment metadata; de-duplicate by URL hash to avoid double analysis.
- Add a lightweight media inspector that resolves headers (content-type, size, duration) before model selection; store results alongside the message for debugging.

## Model Selection & Routing
- Route any media-bearing message to a vision-capable or multi-modal model; if the primary model lacks vision, fall back to a multi-use model with a clear log tag.
- Use a simple policy table (`image`, `gif`, `video`, `unknown`) to decide between single-frame extraction vs. multi-frame sampling, and pass the policy into the handler context.
- If a message mixes text + media, include the text as a separate input segment and preserve ordering so the model sees the caption before the media.

## GIF & Video Handling
- For GIFs, sample representative frames (first, middle, last) and pass them as a multi-image bundle; include timing metadata when available.
- For videos, extract a short storyboard (N frames across the duration) and include duration + timestamps; cap total frames to protect latency.
- Add a small cache keyed by media URL to avoid reprocessing repeated GIFs/videos across the same channel/session.

## Robustness & Fallbacks
- If a media URL cannot be fetched or inspected, log the failure and ask the user to re-upload; do not silently drop the media.
- When analysis exceeds time or size limits, switch to a summary workflow (single frame + user prompt) and note the limitation in the reply.
- Validate embed payloads for missing URLs or unsupported content types; send a short user-facing error explaining what formats are supported.

## Observability & Debugging
- Log which media items were detected, which model handled them, and which extraction policy ran; add a `mediaTraceId` to correlate steps.
- Provide a `/media debug` command that prints the normalized media list and routing decision for the last message.
- Track media-related failures (fetch errors, decode errors, model mismatch) in a structured log to surface regressions quickly.

## Next Steps
1. Add a `normalizeMediaFromMessage` helper in `src/utils` and wire it into message handling.
2. Introduce a `selectMediaModel` policy in `src/handlers` that always picks a vision or multi-use model for embeds.
3. Implement frame sampling utilities for GIFs/videos and log the chosen policy during `/ask` and mention flows.
