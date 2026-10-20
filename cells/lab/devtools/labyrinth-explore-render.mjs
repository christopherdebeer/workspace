// The explorer's cases drawn (node cells/lab/devtools/labyrinth-explore-render.mjs DIR): each case's before, with the
// gesture over it, as cases/<id>/before.png; its after, in cases/<id>/sealed/after.png, to be opened only once the
// before's been read. Plain isometric blocks (labyrinth-iso.mjs), rasterised by a browser with no WebGL.
import './labyrinth-node.mjs';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { iso } from './labyrinth-iso.mjs';
import { read as readAs } from './labyrinth-gestures.mjs';
const { replay } = await import('../client/labyrinth/model.ts');

const root = process.argv[2];
if (!root || !(existsSync(join(root, 'cases')) || existsSync(join(root, 'pairs')))) throw new Error('usage: labyrinth-explore-render.mjs DIR (an explorer output)');
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage();
const png = async (svg, file) => { await page.setContent(`<html><body style="margin:0;background:#f4efe4">${svg}</body></html>`); const el = await page.$('svg'); await el.screenshot({ path: file }); };
// (a stability run's pairs: the gesture and its variant side by side on the one world, before; what each built, sealed)
if (existsSync(join(root, 'pairs'))) {
  for (const id of readdirSync(join(root, 'pairs'))) {
    const dir = join(root, 'pairs', id), b = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')), w0 = replay(b.world);
    const draw = (w, g, title) => iso(w, { focus: [...(b.gesture.path ?? [b.gesture.at]), ...(b.variant.path ?? [b.variant.at])], stroke: g.path ?? null, rests: g.rests ?? [], tap: g.path ? null : g.at, margin: 4, title });
    const two = async (a, c, file) => { await page.setContent(`<html><body style="margin:0;display:flex;gap:8px;background:#f4efe4">${a}${c}</body></html>`); await page.setViewportSize({ width: 1500, height: 700 }); await page.screenshot({ path: file, fullPage: true }); };
    await two(draw(w0, b.gesture, `${id} · as made`), draw(w0, b.variant, `${b.change}`), join(dir, 'before.png'));
    mkdirSync(join(dir, 'sealed'), { recursive: true });
    const after = (g) => { const w1 = replay(b.world); const op = readAs(w1, g); if (op && !('refused' in op)) w1.apply({ ...op, alts: undefined }, 0); return { w1, said: op ? ('refused' in op ? `refused: ${op.refused}` : op.note ?? op.why) : 'nothing' }; };
    const A = after(b.gesture), C = after(b.variant);
    await two(draw(A.w1, b.gesture, `as made · ${A.said}`), draw(C.w1, b.variant, `${b.change} · ${C.said}`), join(dir, 'sealed', 'after.png'));
  }
  await browser.close();
  console.log(`drawn: ${readdirSync(join(root, 'pairs')).length} pairs (before.png; sealed/after.png)`);
  process.exit(0);
}
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
