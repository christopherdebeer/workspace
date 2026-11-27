// Piste's undressed body (client/piste/look/body.ts), measured (node cells/lab/devtools/piste-body.mjs): its girths
// against an adult man's, and how the drafted jacket (static/piste/jacket-draft.json) sits on it:
// how much of it is inside the body, and its ease (how far off the body it stands), by region.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/body'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const f = new M.Fencer(M.EPEE, 0, 1); f.pose();
const body = M.bareBody(f);
const girth = (s) => { let L = 0, prev = null; for (let k = 0; k <= 180; k++) { const a = (k / 180) * Math.PI * 2, r = s.R(a), p = [Math.cos(a) * r, Math.sin(a) * r]; if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; } return L; };
const part = (n) => body.parts.find((p) => p.name === n);
const trunk = part('trunk').sections, hAt = (h) => trunk[Math.round(((h + 0.11) / 0.755) * 46)];
const maxG = (n) => Math.max(...part(n).sections.map(girth));
const rows = [['chest', girth(hAt(0.34)), 0.97], ['waist', girth(hAt(0.12)), 0.82], ['hips', girth(hAt(-0.02)), 0.96], ['upper arm', maxG('upper arm W') * 0.93, 0.30], ['forearm', Math.max(...part('forearm W').sections.map(girth)), 0.27], ['thigh', maxG('thigh F') * 0.97, 0.55], ['calf', Math.max(...part('shin F').sections.map(girth)), 0.37]];
console.log('girths (cm): body / an adult man of 1.80 m');
for (const [n, g, want] of rows) console.log(`  ${n.padEnd(10)} ${(g * 100).toFixed(0).padStart(4)} / ${(want * 100).toFixed(0)}`);
const sh = trunk.reduce((m, s) => Math.max(m, s.R(0) + s.R(Math.PI)), 0);
console.log(`  shoulders across the trunk ${(sh * 100).toFixed(0)} cm (acromion to acromion: about 40)`);

// the drafted jacket on it
const D = JSON.parse(readFileSync(new URL('../static/piste/jacket-draft.json', import.meta.url), 'utf8'));
const pieceOf = (i) => D.pieces.find((p) => i >= p.base && i < p.base + p.rows * p.cols);
const by = new Map();
for (let i = 0; i < D.x.length / 3; i++) {
  const p = [D.x[i * 3], D.x[i * 3 + 1], D.x[i * 3 + 2]], pc = pieceOf(i), row = Math.floor((i - pc.base) / pc.cols) / (pc.rows - 1);
  const region = pc.kind === 'jacket' ? (row < 0.35 ? 'jacket: hips' : row < 0.7 ? 'jacket: chest' : 'jacket: shoulders') : `${pc.kind}: ${row < 0.25 ? 'head' : row < 0.6 ? 'upper' : 'forearm'}`;
  if (!by.has(region)) by.set(region, []);
  by.get(region).push(M.nearSurface(body, p).d);
}
const q = (a, t) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(t * s.length))]; };
console.log('\nthe drafted jacket on this body: inside it, and its ease (cm: median, 90th percentile)');
for (const [region, d] of [...by].sort()) {
  const inside = d.filter((x) => x < 0).length / d.length;
  console.log(`  ${region.padEnd(18)} inside ${(inside * 100).toFixed(0).padStart(3)} %   ease ${(q(d, 0.5) * 100).toFixed(1).padStart(5)} ${(q(d, 0.9) * 100).toFixed(1).padStart(5)}   deepest ${(Math.min(...d) * 100).toFixed(1)}`);
}
