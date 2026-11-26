// Piste's kit as a pattern (node cells/lab/devtools/piste-pattern.mjs): the flat panels client/piste/look/tailor.ts drafts
// to the athlete, laid out on paper with their grain lines and seam lengths, and how the paper compares with the worn
// shape (rest length over worn length, along and round, by piece: above 1, spare cloth; below, the cloth is pulled).
// Writes devtools/out/pattern.png.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/athlete'; export * from './look/tailor';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const A = M.buildAthlete(), pieces = A.pieces.filter((p) => p.closed).slice(0, 5), D = M.tailor(A.verts, pieces);

// rest over worn, by piece and direction
let off = 0;
const stats = [];
for (const p of pieces) {
  const S = p.J - 1, at = (r, c) => { const v = (p.base + r * p.J + ((c % S) + S) % S) * M.SKIN_STRIDE; return [A.verts[v], A.verts[v + 1], A.verts[v + 2]]; };
  const ratio = { along: [], round: [] };
  for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) {
    const i = off + r * S + c;
    if (r + 1 < p.R) { const w = Math.hypot(...at(r, c).map((x, k) => x - at(r + 1, c)[k])); if (w > 1e-5) ratio.along.push(D.rest[i * 12] / w); }
    const w = Math.hypot(...at(r, c).map((x, k) => x - at(r, c + 1)[k])); if (w > 1e-5) ratio.round.push(D.rest[i * 12 + 2] / w);
  }
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
  stats.push(`${p.kind.padEnd(9)} along ${[0.05, 0.5, 0.95].map((f) => q(ratio.along, f).toFixed(3)).join(' / ')}   round ${[0.05, 0.5, 0.95].map((f) => q(ratio.round, f).toFixed(3)).join(' / ')}`);
  off += p.R * S;
}
console.log('rest ÷ worn (5th / 50th / 95th percentile):\n' + stats.join('\n'));

// the paper: each piece's panels in a row, pieces down the page, 1 m = 500 px
const SC = 500, PAD = 24, names = { jacket: 'jacket body', sleeveW: 'weapon sleeve', sleeveR: 'rear sleeve', breeches: 'breeches leg' };
let y = 40, svg = '', W = 0;
const groups = [];
for (const s of D.sheets) { const g = groups[groups.length - 1]; if (g && g.piece === s.piece && g.idx === groups.length - 1 && g.sheets[0].panel < s.panel) g.sheets.push(s); else groups.push({ piece: s.piece, idx: groups.length, sheets: [s] }); }
for (const g of groups) {
  let x = PAD, h = 0;
  svg += `<text x="${PAD}" y="${y - 10}" font-size="13" fill="#333">${names[g.piece]}</text>`;
  for (const s of g.sheets) {
    const xs = s.outline.map((p) => p[0]), ys = s.outline.map((p) => p[1]), x0 = Math.min(...xs), y1 = Math.max(...ys), w = (Math.max(...xs) - x0) * SC, hh = (y1 - Math.min(...ys)) * SC;
    const P = (p) => `${(x + (p[0] - x0) * SC).toFixed(1)},${(y + (y1 - p[1]) * SC).toFixed(1)}`;
    svg += `<polygon points="${s.outline.map(P).join(' ')}" fill="#f4efe2" stroke="#5a5040" stroke-width="1"/>`;
    svg += `<line x1="${P(s.grain[0]).split(',')[0]}" y1="${P(s.grain[0]).split(',')[1]}" x2="${P(s.grain[1]).split(',')[0]}" y2="${P(s.grain[1]).split(',')[1]}" stroke="#a33" stroke-dasharray="5 3"/>`;
    svg += `<text x="${x + 4}" y="${y + hh + 14}" font-size="10" fill="#666">panel ${s.panel + 1}: seams ${(s.seams.left * 100).toFixed(1)} / ${(s.seams.right * 100).toFixed(1)} cm</text>`;
    x += w + PAD; h = Math.max(h, hh);
  }
  W = Math.max(W, x); y += h + 56;
}
svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>${svg}</svg>`;
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const path = new URL('./out/pattern.svg', import.meta.url).pathname;
writeFileSync(path, svg);
const { chromium } = await import('playwright');
const br = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }), pg = await br.newPage({ viewport: { width: Math.ceil(W), height: Math.ceil(y) } });
await pg.setContent(svg); await pg.screenshot({ path: path.replace(/svg$/, 'png') }); await br.close();
console.log(path.replace(/svg$/, 'png'));
