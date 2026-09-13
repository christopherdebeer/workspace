// ── WHAT A RAILWAY IS, FROM ITS TAGS ──
//
// `railSpec` is pure, so this runs in node in milliseconds and needs no
// browser, no world and no network — which matters more here than usual,
// because until the capture that came with this unit there was NO fixture in
// this repo containing a railway at all (`railway` was missing from
// capture-world's KEEP_TAGS as well as the game's, and all nine captures held
// zero railway ways — Simon's Town included, which the Southern Line runs
// through). Everything deterministic about railways starts here.
//
//   node devtools/railway.test.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CELL = dirname(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = join(CELL, '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'railtest');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'),
  `export { railSpec, railRepeatY, drawRailTexture } from ${JSON.stringify(join(CELL, 'client', 'railway'))};\n`);
execFileSync('npx', ['esbuild', join(OUT, 'entry.ts'), '--bundle', '--format=esm', '--platform=node',
  '--outfile=' + join(OUT, 'railway.mjs'), '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
const { railSpec, railRepeatY, drawRailTexture } = await import(join(OUT, 'railway.mjs') + '?v=' + Date.now());

let fails = 0;
const ok = (pass, line, extra) => {
  if (!pass) fails++;
  console.log(`${pass ? '  ok  ' : 'FAIL  '}${line}${extra !== undefined && !pass ? `  — ${JSON.stringify(extra)}` : ''}`);
};

// ── THE SEAT'S OWN WAY, tag for tag as the cell serves it ──
const GLENCAIRN = { railway: 'rail', usage: 'main', gauge: '1067', electrified: 'contact_line',
  voltage: '3000', passenger_lines: '1', operator: 'PRASA', direction: 'both' };
{
  const s = railSpec(GLENCAIRN);
  ok(s.draw && s.kind === 'rail', 'Glencairn: a main line draws, as rail', s);
  ok(Math.abs(s.gaugeM - 1.067) < 1e-9, 'Cape gauge is read from the tag, not assumed', s.gaugeM);
  ok(!s.minor && !s.disused && s.electrified, 'main line, in use, under wires', s);
  ok(s.ballast === 'stone', 'and it is laid on stone', s.ballast);
  // The formation: a 1.067 m gauge carries a ~2.2 m sleeper on a ~3.3 m bed.
  ok(Math.abs(s.sleeperLenM - 2.217) < 0.01, 'the sleeper is 1.75 gauges and a bit', s.sleeperLenM);
  ok(s.widthM > 3.2 && s.widthM < 3.5, 'the formation is about 3.3 m wide', s.widthM);
}
// ── AND THE WIDTH MUST NOT OVERLAP ITS OWN NEIGHBOUR ──
// OSM maps double track as two parallel ways about four metres apart. A
// formation much over four metres would put each way's ballast through its
// neighbour's, and two polygon-offset ribbons sharing ground z-fight the
// length of the line. Standard gauge is the widest ordinary case.
{
  const std = railSpec({ railway: 'rail' });
  ok(Math.abs(std.gaugeM - 1.435) < 1e-9, 'no gauge tag means standard gauge', std.gaugeM);
  ok(std.widthM <= 4.0, 'standard gauge still fits inside a four-metre track spacing', std.widthM);
  const irish = railSpec({ railway: 'rail', gauge: '1600' });
  ok(irish.widthM <= 4.5, '…and so does the widest gauge in ordinary use', irish.widthM);
}
// ── THE GAUGE PARSE ──
{
  ok(railSpec({ railway: 'rail', gauge: '1435;1000' }).gaugeM === 1.435,
    'mixed-gauge track is drawn at the first gauge listed');
  ok(Math.abs(railSpec({ railway: 'rail', gauge: '762' }).gaugeM - 0.762) < 1e-9, 'a two-foot-six gauge is read');
  ok(railSpec({ railway: 'rail', gauge: 'broad' }).gaugeM === 1.435, 'a word instead of a number falls back');
  ok(railSpec({ railway: 'rail', gauge: '99999' }).gaugeM === 1.435, 'and so does a number that cannot be a gauge');
  ok(Math.abs(railSpec({ railway: 'narrow_gauge' }).gaugeM - 1.0) < 1e-9, 'narrow_gauge has its own convention');
}
// ── WHAT MUST NOT DRAW, which is the half that was missing entirely ──
// The old branch was `else if (tags.railway)` with no filter, so every one of
// these put a surface ribbon on the ground.
for (const [tags, why] of [
  [{ railway: 'subway', tunnel: 'yes' }, 'a subway in a tunnel is not on the surface'],
  [{ railway: 'abandoned' }, 'abandoned track was lifted'],
  [{ railway: 'razed' }, 'razed track is gone'],
  [{ railway: 'dismantled' }, 'dismantled track is gone'],
  [{ railway: 'construction' }, 'track under construction is not there yet'],
  [{ railway: 'proposed' }, 'proposed track is a line on a plan'],
  [{ railway: 'platform' }, 'a platform is not a track'],
  [{ railway: 'turntable' }, 'a turntable is not a way'],
  [{ railway: 'engine_shed' }, 'an engine shed is a building'],
  [{ railway: 'monorail' }, 'a monorail is a beam, not a ballasted track'],
]) ok(!railSpec(tags).draw, why, railSpec(tags));
// …and the one that must: an elevated or open subway section is real.
ok(railSpec({ railway: 'subway' }).draw, 'a subway NOT in a tunnel is drawn — elevated sections are real');
ok(railSpec({ railway: 'subway', tunnel: 'no' }).draw, '…and tunnel=no is not a tunnel');

// ── A SIDING IS NOT A MAIN LINE ──
{
  const sid = railSpec({ railway: 'rail', service: 'siding' });
  ok(sid.minor && sid.ballast === 'slag', 'a siding is demoted by its service tag', sid);
  ok(sid.sleeperM > railSpec({ railway: 'rail' }).sleeperM, '…and is laid sparser');
  ok(sid.liftM < railSpec({ railway: 'rail' }).liftM, '…on less stone');
  ok(railSpec({ railway: 'rail', usage: 'industrial' }).minor, 'usage=industrial demotes it too');
  ok(!railSpec({ railway: 'rail', usage: 'main' }).minor, 'usage=main does not');
}
// ── A TRAM RUNS IN A STREET ──
{
  const t = railSpec({ railway: 'tram', electrified: 'contact_line' });
  ok(t.draw && t.ballast === 'none', 'a tram has no ballast — it is set in the roadway', t);
  ok(t.liftM < 0.05, '…and lies flush in it', t.liftM);
  ok(t.widthM < 2.5, '…and its strip is the rails and little else', t.widthM);
}
// ── DISUSED: THE RAILS ARE STILL DOWN ──
{
  const d = railSpec({ railway: 'disused' });
  ok(d.draw && d.disused, 'disused track is still there and is drawn');
  ok(railSpec({ railway: 'rail', disused: 'yes' }).disused, 'and so is a rail way tagged disused');
}
// ── THE v REPEAT IS WHAT MAKES A SLEEPER A SLEEPER ──
// The ribbon's v is `along / 20`, fixed. One canvas height must come out as
// exactly `sleepers × sleeperM` of track, or the pitch is whatever 20 m
// happened to divide into.
{
  const s = railSpec(GLENCAIRN);
  const wrapM = 20 / railRepeatY(s);
  ok(Math.abs(wrapM - s.sleepers * s.sleeperM) < 1e-9,
    `one canvas wrap is exactly ${s.sleepers} sleepers of ${s.sleeperM} m (${wrapM.toFixed(2)} m)`, wrapM);
  // …and that has to leave enough canvas per metre for the pattern to survive
  // the quantiser. 128 px over 5.2 m is 24.6 px/m; a sleeper's own pitch is
  // then 16 px, which is a rhythm rather than a dither.
  ok(128 / wrapM > 18, 'which leaves over eighteen canvas pixels per metre along the track', 128 / wrapM);
}
// ── THE DRAW ROUTINE TOUCHES A CANVAS AND NOTHING ELSE ──
// Pure enough to run against a recording stub, which is what says it needs no
// DOM beyond a 2d context — and that every spec it is handed draws SOMETHING.
{
  for (const tags of [GLENCAIRN, { railway: 'rail' }, { railway: 'tram' }, { railway: 'disused' },
    { railway: 'rail', service: 'siding' }, { railway: 'narrow_gauge' }, { railway: 'miniature' }]) {
    const spec = railSpec(tags);
    if (!spec.draw) continue;
    const calls = [];
    const c = new Proxy({}, {
      get: (_t, k) => (k === 'fillStyle' ? '' : (...a) => calls.push([k, ...a])),
      set: () => true,
    });
    let seed = 1;
    const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    drawRailTexture(c, 128, rng, spec);
    const rects = calls.filter(([k]) => k === 'fillRect');
    ok(rects.length > 40, `${spec.key}: the canvas is drawn (${rects.length} fills)`, rects.length);
    const anyOff = rects.some(([, x, y, w, h]) => !Number.isFinite(x + y + w + h));
    ok(!anyOff, `${spec.key}: every fill has finite bounds`);
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
