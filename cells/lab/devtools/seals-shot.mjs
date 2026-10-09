// Render seals headless to PNG, for looking at them beside the references.
// node cells/lab/devtools/seals-shot.mjs <out.png> [seed] [ranks e.g. 3,6,9] [suits e.g. 0,1,2,3] [bare]   (env: MODE=shown|hidden|zones, OVERLAY=1, OVER={"packMax":4} style overrides)
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('seals/seal.ts'), T = await load('seals/styles.ts'), D = await load('markovs/deck.ts'), H = await load('seals/shapes.ts');
const [out = 'seals.png', seedArg = '1', ranksArg = '3,6,9', suitsArg = '0,1,2,3', bare] = process.argv.slice(2);
const seed = Number(seedArg), ranks = ranksArg.split(',').map(Number), suits = suitsArg.split(',').map(Number);
const ROMAN = ['', 'A', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
let cells = '';
if (process.env.SHAPES) for (const kind of (process.env.SHAPES === '1' ? H.SHAPE_KINDS : process.env.SHAPES.split(','))) for (const suit of suits) { const t = H.shapeTile({ kind, style: { ...T.SUIT_STYLES[suit], ...JSON.parse(process.env.OVER ?? '{}') }, seed, label: process.env.LABEL ?? 'Markovs', overlay: !!process.env.OVERLAY }); cells += `<div>${t.svg.replace('<svg ', '<svg style="height:420px" ')}<pre style="margin:0;font-size:11px">${kind} ${JSON.stringify(t.fill.stats)}</pre></div>`; }
for (const rank of process.env.SHAPES ? [] : ranks) for (const suit of suits) {
  const faces = bare ? null : D.facesOf({ suit, rank });
  const title = `${ROMAN[rank]} · ${rank === 1 ? 'WILD' : D.SHAPES[rank].name}`;
  if (process.env.SEALONLY) { const st = S.sample({ ...T.SUIT_STYLES[suit], ...JSON.parse(process.env.OVER ?? '{}') }, seed); const mode = process.env.MODE ?? 'shown'; const seal = S.draw(st, faces, seed, { show: mode === 'shown', zones: mode !== 'hidden', stats: true, rank }); cells += `<div><svg viewBox="-64 -64 128 128" style="height:420px;background:${st.paper}">${S.sealSvg(seal, st, `q${rank}${suit}`)}${process.env.OVERLAY || mode === 'zones' ? S.overlaySvg(process.env.OVERLAY ? seal.discs : [], seal.zones, 0.25) : ''}</svg><pre style="margin:0;font-size:11px">${JSON.stringify(seal.stats)}</pre></div>`; continue; }
  cells += `<div>${S.sealCard({ style: { ...T.SUIT_STYLES[suit], ...JSON.parse(process.env.OVER ?? '{}') }, seed, rank, faces, title, id: `c${rank}${suit}`, mode: process.env.MODE ?? 'shown', overlay: !!process.env.OVERLAY })}</div>`;
}
const html = `<!doctype html><body style="margin:0;background:#ddd"><div style="display:grid;grid-template-columns:repeat(${suits.length},420px);gap:12px;padding:12px">${cells}</div><style>svg{width:420px;height:587px;display:block}</style></body>`;
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }); const page = await browser.newPage({ viewport: { width: suits.length * 432 + 12, height: 600 } });
await page.setContent(html); await page.screenshot({ path: out, fullPage: true }); await browser.close();
console.log(out);
