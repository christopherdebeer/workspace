// Render seals headless to PNG, for looking at them beside the references.
// node cells/lab/devtools/seals-shot.mjs <out.png> [seed] [ranks e.g. 3,6,9] [suits e.g. 0,1,2,3] [bare]
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('seals/seal.ts'), T = await load('seals/styles.ts'), D = await load('markovs/deck.ts');
const [out = 'seals.png', seedArg = '1', ranksArg = '3,6,9', suitsArg = '0,1,2,3', bare] = process.argv.slice(2);
const seed = Number(seedArg), ranks = ranksArg.split(',').map(Number), suits = suitsArg.split(',').map(Number);
const ROMAN = ['', 'A', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
let cells = '';
for (const rank of ranks) for (const suit of suits) {
  const faces = bare ? null : D.facesOf({ suit, rank });
  const title = `${ROMAN[rank]} · ${rank === 1 ? 'WILD' : D.SHAPES[rank].name}`;
  cells += `<div>${S.sealCard({ style: T.SUIT_STYLES[suit], seed, faces, title, id: `c${rank}${suit}` })}</div>`;
}
const html = `<!doctype html><body style="margin:0;background:#ddd"><div style="display:grid;grid-template-columns:repeat(${suits.length},420px);gap:12px;padding:12px">${cells}</div><style>svg{width:420px;height:587px;display:block}</style></body>`;
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }); const page = await browser.newPage({ viewport: { width: suits.length * 432 + 12, height: 600 } });
await page.setContent(html); await page.screenshot({ path: out, fullPage: true }); await browser.close();
console.log(out);
