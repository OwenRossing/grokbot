import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, '../../tmp');

// Ensure tmp directory exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export async function isGif(url) {
  return /\.gif(\?.*)?$/i.test(url) || url.includes('tenor.com') || url.includes('giphy.com');
}

export async function gifToPngSequence(gifUrl, options = {}) {
  const fps = options.fps || 0.5; // half fps (default 30fps GIF becomes 15fps)
  const scale = options.scale || '75'; // 75% resolution
  const maxFrames = options.maxFrames || 8; // Limit to 8 frames for token efficiency

  const sessionId = `gif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const sessionDir = path.join(TMP_DIR, sessionId);

  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    // Download GIF
    const gifPath = path.join(sessionDir, 'input.gif');
    await downloadGif(gifUrl, gifPath);

    // Check file size
    const stats = fs.statSync(gifPath);
    if (stats.size > 50 * 1024 * 1024) {
      // Skip if GIF is >50MB
      console.warn(`GIF too large (${stats.size} bytes), skipping conversion`);
      return [];
    }

    // Count total frames first
    const countResult = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_packets',
      '-of', 'csv=p=0',
      gifPath
    ], { encoding: 'utf-8' });

    let totalFrames = 100; // Default estimate
    if (countResult.stdout) {
      totalFrames = parseInt(countResult.stdout.trim(), 10) || 100;
    }

    // Calculate actual FPS to hit maxFrames limit
    const actualFps = Math.min(fps, Math.max(0.25, (maxFrames / totalFrames) * fps));

    // Convert GIF to PNG sequence with ffmpeg
    const framePattern = path.join(sessionDir, 'frame_%03d.png');
    const ffmpegCmd = [
      '-i', gifPath,
      '-vf', `fps=${actualFps},scale=iw*${scale/100}:ih*${scale/100}:flags=lanczos`,
      framePattern
    ];

    spawnSync('ffmpeg', ffmpegCmd, {
      stdio: ['pipe', 'pipe', 'pipe'], // Suppress output
      timeout: 30000 // 30 second timeout
    });

    // Read frames and convert to base64 data URLs
    const frames = fs.readdirSync(sessionDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .slice(0, maxFrames)
      .map(f => {
        const buffer = fs.readFileSync(path.join(sessionDir, f));
        return `data:image/png;base64,${buffer.toString('base64')}`;
      });

    console.log(`Converted GIF to ${frames.length} frames at ${actualFps}fps (75% scale)`);
    return frames;
  } catch (err) {
    console.error('GIF conversion error:', err.message);
    return []; // Return empty array on error so conversation can continue without images
  } finally {
    // Cleanup
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Failed to cleanup GIF session ${sessionId}:`, e.message);
    }
  }
}

async function downloadGif(url, dest) {
  try {
    const response = await fetch(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GIF: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
  } catch (err) {
    throw new Error(`GIF download failed: ${err.message}`);
  }
}
