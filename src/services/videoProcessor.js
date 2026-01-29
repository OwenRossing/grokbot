import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, '../../tmp');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function readDurationSeconds(filePath) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ], { encoding: 'utf-8' });
  if (probe.error || probe.status !== 0) return 0;
  const duration = parseFloat((probe.stdout || '').trim());
  return Number.isFinite(duration) ? duration : 0;
}

async function downloadVideo(url, dest, maxBytes = 75 * 1024 * 1024) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch video: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.includes('video') && !contentType.includes('application/octet-stream')) {
    throw new Error(`Unexpected content-type for video: ${contentType}`);
  }
  const length = res.headers.get('content-length');
  if (length && Number(length) > maxBytes) {
    throw new Error(`Video too large (${length} bytes)`);
  }

  const file = fs.createWriteStream(dest);
  const finishPromise = new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
  });
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) {
      file.close();
      throw new Error(`Video too large (streamed ${total} bytes)`);
    }
    file.write(chunk);
  }
  file.end();
  await finishPromise;
}

export async function videoToPngStoryboard(videoUrl, options = {}) {
  const maxFrames = options.maxFrames || 4;
  const scale = options.scale || 60;
  const sessionId = `video-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const sessionDir = path.join(TMP_DIR, sessionId);
  const videoPath = path.join(sessionDir, 'input.mp4');

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    await downloadVideo(videoUrl, videoPath);

    const duration = readDurationSeconds(videoPath);
    const baseFps = duration > 0 ? Math.min(1, Math.max(0.1, maxFrames / duration)) : 0.2;
    const framePattern = path.join(sessionDir, 'frame_%03d.png');
    const ffmpeg = spawnSync('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', videoPath,
      '-vf', `fps=${baseFps},scale=iw*${scale / 100}:ih*${scale / 100}:flags=lanczos`,
      '-frames:v', String(maxFrames),
      framePattern,
    ], { encoding: 'utf-8', timeout: 30000 });

    if (ffmpeg.error || ffmpeg.status !== 0) {
      if (ffmpeg.stderr) {
        console.warn('ffmpeg video sampling failed:', ffmpeg.stderr.trim());
      }
      return [];
    }

    const frames = fs.readdirSync(sessionDir)
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()
      .slice(0, maxFrames)
      .map((f) => {
        const buffer = fs.readFileSync(path.join(sessionDir, f));
        return `data:image/png;base64,${buffer.toString('base64')}`;
      });

    return frames;
  } catch (err) {
    console.error('Video storyboard error:', err.message);
    return [];
  } finally {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`Failed to cleanup video session ${sessionId}:`, cleanupErr.message);
    }
  }
}
