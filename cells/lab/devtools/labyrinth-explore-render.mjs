// The explorer's cases drawn (node cells/lab/devtools/labyrinth-explore-render.mjs DIR): each case's before, with the
// gesture over it, as cases/<id>/before.png; its after, in cases/<id>/sealed/after.png, to be opened only once the
// before's been read. Plain isometric blocks (labyrinth-iso.mjs), rasterised by a browser with no WebGL.
import './labyrinth-node.mjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { iso } from './labyrinth-iso.mjs';
const { replay } = await import('../client/labyrinth/model.ts');

const root = process.argv[2];
if (!root || !existsSync(join(root, 'cases'))) throw new Error('usage: labyrinth-explore-render.mjs DIR (an explorer output)');
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage();
const png = async (svg, file) => { await page.setContent(`<html><body style="margin:0;background:#f4efe4">${svg}</body></html>`); const el = await page.$('svg'); await el.screenshot({ path: file }); };
for (const id of readdirSync(join(root, 'cases'))) {
  const dir = join(root, 'cases', id), b = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')), c = JSON.parse(readFileSync(join(dir, 'sealed.json'), 'utf8'));
  const g = b.gesture, w0 = replay(b.world), w1 = replay(c.after);
  const cells = g.path ?? [g.at], focus = [...cells];
  const label = `${id} · ${g.intent}${g.kind === 'lift' ? ` · drawn ${g.by > 0 ? 'up' : 'down'} ${Math.abs(g.by)}` : ''}`;
  const opts = { focus, stroke: g.path ?? null, rests: g.rests ?? [], tap: g.path ? null : g.at, margin: 4 };
  await png(iso(w0, { ...opts, title: `${label} · before` }), join(dir, 'before.png'));
  mkdirSync(join(dir, 'sealed'), { recursive: true });
  await png(iso(w1, { ...opts, title: `${label} · after` }), join(dir, 'sealed', 'after.png'));
}
await browser.close();
console.log(`drawn: ${readdirSync(join(root, 'cases')).length} cases (before.png; sealed/after.png)`);
