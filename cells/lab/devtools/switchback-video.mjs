/**
 * Switchback to video, headless: the page opened with `rec=headless`, sized, stepped one frame at a time at a fixed
 * 1/fps (so it's smooth however slow the software GL is), each frame handed back as a JPEG and piped into ffmpeg.
 *
 *   node cells/lab/devtools/switchback-video.mjs 'seed=1&paint=1&cam=mid' --seconds 10 --fps 30 --size 1280x720 --out ride.mp4
 *   node cells/lab/devtools/switchback-video.mjs 'seed=1&at=600&paint=1' --seconds 6 --size 720x1280
 *
 * The query is the game's own flags (`t=` to start further down, `at=` to start at a station, `cam=`, `paint=`); the
 * rider is on the autopilot. Writes devtools/out/<out> (default switchback.mp4).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

process.env.EXPERIMENT = 'switchback'; process.env.READY = '__switchback';
const { withWood, OUT } = await import('./harness.mjs');

const args = process.argv.slice(2), query = args.find((a) => !a.startsWith('--')) ?? 'seed=1&paint=1';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const seconds = Number(opt('seconds', 8)), fps = Number(opt('fps', 30)), [w, h] = opt('size', '1280x720').split('x').map(Number);
const out = join(OUT, opt('out', 'switchback.mp4')), warm = Number(opt('warm', 1.0));

await withWood(async (lab) => {
  const page = await lab.open(`${query}&rec=headless&preview`, { width: Math.min(w, 1280), height: Math.min(h, 1280) });
  await page.waitForFunction(() => !!window.__rec, null, { timeout: 60000 });
  await page.evaluate(([a, b]) => window.__rec.size(a, b), [w, h]);
  // (warm up: the chunks streamed and painted, the paint front run out, before the first frame kept)
  for (let i = 0; i < Math.round(warm * fps); i++) await page.evaluate((dt) => { window.__rec.step(dt); }, 1 / fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(seconds * fps), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const url = await page.evaluate((dt) => window.__rec.step(dt, 0.92), i ? 1 / fps : 0);
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 30 === 0) process.stdout.write(`frame ${i + 1}/${n} · ${((Date.now() - t0) / (i + 1)).toFixed(0)} ms a frame\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`wrote ${out} (${seconds} s, ${fps} fps, ${w}×${h}); page errors: ${JSON.stringify(page.errors.slice(0, 3))}`);
  await page.close();
});
