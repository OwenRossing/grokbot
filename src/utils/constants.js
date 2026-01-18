// Discord error codes
export const DISCORD_INTERACTION_EXPIRED_CODE = 10062;
export const DISCORD_UNKNOWN_MESSAGE_CODE = 10008;
export const DISCORD_BULK_DELETE_LIMIT = 100;

// Media limits
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

// Regex patterns
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)(\?.*)?$/i;
export const VIDEO_MIME_PREFIXES = ['video/'];

// Emojis
export const NUMBER_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// Time constants
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
