import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.join(__dirname, '../../../tmp/tcg-reveal-cache');

const RARITY_EFFECTS = {
  1: { duration: 1.6, fps: 12, tint: 'white@0.04' },
  2: { duration: 1.8, fps: 13, tint: 'cyan@0.05' },
  3: { duration: 2.0, fps: 14, tint: 'lime@0.06' },
  4: { duration: 2.2, fps: 14, tint: 'yellow@0.07' },
  5: { duration: 2.4, fps: 15, tint: 'magenta@0.08' },
  6: { duration: 2.6, fps: 15, tint: 'red@0.08' },
};

if (!fs.existsSync(TMP_ROOT)) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
}

function safeTier(tier) {
  const n = Number(tier || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(6, Math.round(n)));
}

function hashKey(payload) {
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function cachePath(key) {
  const dir = path.join(TMP_ROOT, key.slice(0, 2));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${key}.gif`);
}

async function downloadImage(url, dest) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`image download failed: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, bytes);
}

function renderGif({ sourcePath, outputPath, tier }) {
  const fx = RARITY_EFFECTS[safeTier(tier)] || RARITY_EFFECTS[1];
  const vf = [
    `fps=${fx.fps}`,
    'scale=512:-1:flags=lanczos',
    'pad=512:720:(ow-iw)/2:(oh-ih)/2:black',
    "zoompan=z='min(zoom+0.0015,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=512x720",
    `drawbox=x=0:y=0:w=iw:h=ih:color=${fx.tint}:t=fill`,
  ].join(',');

  const run = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-loop', '1',
      '-t', String(fx.duration),
      '-i', sourcePath,
      '-vf', vf,
      outputPath,
    ],
    { encoding: 'utf-8', timeout: 30000 }
  );

  if (run.error || run.status !== 0) {
    throw new Error(run.stderr?.trim() || run.error?.message || 'ffmpeg failed');
  }
}

export async function renderRevealGif(card, options = {}) {
  const imageUrl = card?.image_large || card?.image_small || '';
  if (!imageUrl) {
    return { ok: false, reason: 'missing_image' };
  }

  const themeVersion = options.themeVersion || 'v1';
  const effectVersion = options.effectVersion || 'v1';
  const tier = safeTier(card?.rarity_tier);
  const key = hashKey(`${card.card_id}:${tier}:${themeVersion}:${effectVersion}:${imageUrl}`);
  const gifPath = cachePath(key);

  if (fs.existsSync(gifPath)) {
    return { ok: true, gifPath, cacheHit: true };
  }

  const sessionDir = path.join(TMP_ROOT, `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const inputPath = path.join(sessionDir, 'card-input');
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    await downloadImage(imageUrl, inputPath);
    renderGif({ sourcePath: inputPath, outputPath: gifPath, tier });
    return { ok: true, gifPath, cacheHit: false };
  } catch (err) {
    return { ok: false, reason: err.message || 'render_failed' };
  } finally {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {}
  }
}
