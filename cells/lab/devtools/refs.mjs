// Reference clips, fetched and laid out for study, from a manifest that records where each came from and what is in it
// (devtools/refs/<set>.json). The clips and their frames are never committed (they aren't ours): this makes them again,
// whenever, into devtools/out/refs/<id>/ (git-ignored):
//
//   node cells/lab/devtools/refs.mjs roofjumps            every clip in the set: fetched, a contact sheet, a strip a segment
//   node cells/lab/devtools/refs.mjs roofjumps kyo-stair  one clip
//   node cells/lab/devtools/refs.mjs roofjumps --list     what's in the set, segment by segment, with its labels
//
// Needs yt-dlp and ffmpeg on the path. A clip that's gone from its source can't be made again: the manifest's labels and
// timings still say what it was.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const [set = 'roofjumps', ...rest] = process.argv.slice(2);
const list = rest.includes('--list'), only = rest.filter((a) => !a.startsWith('--'));
const manifest = JSON.parse(readFileSync(join(here, 'refs', `${set}.json`), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%');

for (const c of manifest.clips) {
  if (only.length && !only.includes(c.id)) continue;
  if (list) {
    console.log(`\n${c.id}  ${c.url ?? '(url not recorded)'}\n  ${c.title}${c.titleEn ? ` (${c.titleEn})` : ''} · ${c.author} · ${c.uploaded ?? '?'} · ${c.duration ?? '?'} s`);
    for (const s of c.segments ?? []) console.log(`  ${s.t0.toFixed(2).padStart(6)}–${s.t1.toFixed(2).padEnd(6)} ${s.label}${s.moves ? `  [${s.moves.join(', ')}]` : ''}`);
    continue;
  }
  if (!c.url) { console.log(`${c.id}: no url recorded, skipped`); continue; }
  const dir = join(here, 'out', 'refs', c.id), src = join(dir, 'source.mp4');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(src)) { console.log(`${c.id}: fetching ${c.url}`); run('yt-dlp', ['-q', '--no-playlist', '-f', 'mp4/best', '-o', src, c.url]); }
  // (the whole clip at a glance: timed, a few frames a second)
  const sheet = c.sheet ?? { fps: 4, cols: 6 }, rows = Math.ceil(((c.duration ?? 30) * sheet.fps) / sheet.cols);
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `fps=${sheet.fps},scale=320:-1,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.6,tile=${sheet.cols}x${rows}`, '-frames:v', '1', join(dir, 'sheet.png')]);
  // (each labelled segment as a strip: denser, its label on every frame, the time from the clip's start)
  for (const [i, s] of (c.segments ?? []).entries()) {
    const fps = s.fps ?? 12, n = Math.max(1, Math.round((s.t1 - s.t0) * fps)), cols = Math.min(n, s.cols ?? 12), r = Math.ceil(n / cols);
    const label = esc(`${s.label}`), crop = s.crop ? `crop=${s.crop},` : '';
    const name = `${String(i + 1).padStart(2, '0')}-${s.slug ?? s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`;
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(s.t0), '-t', String(s.t1 - s.t0), '-i', src, '-vf',
      `${crop}fps=${fps},scale=${s.width ?? 240}:-1,drawtext=text='%{pts\\:hms\\:${s.t0}}':x=4:y=4:fontsize=12:fontcolor=white:box=1:boxcolor=black@0.6,drawtext=text='${label}':x=4:y=h-18:fontsize=11:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${r}`,
      '-frames:v', '1', join(dir, name)]);
  }
  writeFileSync(join(dir, 'README.txt'), `${c.title}\n${c.url}\n${c.author}, ${c.uploaded ?? ''}\nmade by devtools/refs.mjs from devtools/refs/${set}.json: not ours, never committed\n`);
  console.log(`${c.id}: ${dir}`);
}
