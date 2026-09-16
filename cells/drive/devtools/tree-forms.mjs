/**
 * ── THE CONTROL SET: EVERY EZ VARIANT, THE SAME FRAMING, WITH ITS CLOSURE ──
 *
 *   node cells/drive/devtools/tree-forms.mjs
 *   PX=160 MAG=2 node .../tree-forms.mjs          (a coarser sheet, magnified)
 *   ELEV=8,32,90 node .../tree-forms.mjs          (one sheet per elevation)
 *
 * The seat's ask: a control set across forms and varieties FIRST, then improve
 * dramatically against that baseline. A tree is a judgement, so the baseline is
 * pictures — and a picture with no number beside it cannot say whether the next
 * bake improved anything, so every cell carries CLOSURE: the share of the
 * tree's own bounding box its silhouette fills.
 *
 * WHY THAT NUMBER AND NOT ANOTHER. The bake already measures `clear`, `width`,
 * `taper` and `card`, and its one gate flags a leaf card WIDER than a quarter
 * of its crown — the stack-of-plates fault it was written for. Nothing measures
 * whether the crown CLOSES, which is the opposite fault and the one the seat
 * reported: *our real trees are a little too skeleton like*. The impostor atlas
 * made it visible (a Yosemite conifer fills 7 to 10 per cent of its box) and
 * this puts it beside the frame that explains it.
 *
 * IT IS THE SHIPPED GEOMETRY THROUGH THE SHIPPED MATERIAL, framed by each
 * variant's own bounding box so two trees of different size are comparable.
 * No world, no streaming, no fixture arrival order: the sheet is the same every
 * run, which is what makes it a control.
 *
 * TWO SHEETS BY DEFAULT and the reason is the whole tier: one at the seat's own
 * scale, where the question is whether this reads as an oak or a pine, and one
 * at the size a tree is actually DRAWN at past the impostor handover (about 25
 * art pixels), where the question is whether anything survives at all.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.DRIVE_WORK ?? '/tmp/drive-tools';
const FIX = process.env.FIX ?? 'at-yosemite';
const ELEVS = (process.env.ELEV ?? '8,35').split(',').map(Number);
const PX = Number(process.env.PX ?? 224);
const MAG = Number(process.env.MAG ?? 1);
const COLS = Number(process.env.COLS ?? 6);
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
console.log(`[${el()}] booting ${FIX}`);
const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1`,
  tag: 'tree-forms', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// THE VARIANTS ARE DECODED LAZILY, so ask for them before photographing: a
// sheet taken before `ezVariants` has ever been called for a family would be a
// sheet of whatever had happened to be needed by the world so far.
await d.page.waitForTimeout(4000);

const sheets = [];
for (const elev of ELEVS) {
  console.log(`[${el()}] sheet at ${elev} degrees`);
  const r = await q((o) => window.__ezsheet(o), { px: PX, mag: MAG, cols: COLS, elev });
  const file = join(OUT, `tree-forms-e${elev}.png`);
  writeFileSync(file, Buffer.from(r.sheet.split(',')[1], 'base64'));
  sheets.push({ elev, file, rows: r.rows });
}
await d.close();

const rows = sheets[0].rows;
console.log(`\n── the control set · ${rows.length} variants · ${PX}px cells`);
console.log(`  ${'variant'.padEnd(22)}${'form'.padEnd(11)}${'crown'.padEnd(8)}${'tris'.padStart(6)}`
  + `${'w/h'.padStart(7)}${ELEVS.map((e) => `  closure@${e}`.padStart(14)).join('')}`);
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  console.log(`  ${r.label.padEnd(22)}${r.form.padEnd(11)}${String(r.crown).padEnd(8)}`
    + `${String(r.tris).padStart(6)}${(r.hx / r.hy).toFixed(2).padStart(7)}`
    + sheets.map((s) => `${(s.rows[i].closure * 100).toFixed(1)}%`.padStart(14)).join(''));
}
// ── THE SUMMARY IS BY FORM, because that is the unit a guild asks for ──
// A guild says "conic, columnar"; if every conic variant is thin then the
// place the guild describes is thin, whatever the family's mean says.
const byForm = new Map();
for (const r of rows) {
  const a = byForm.get(r.form) ?? [];
  a.push(r.closure); byForm.set(r.form, a);
}
console.log(`\n  by form (closure at ${ELEVS[0]} degrees)`);
for (const [form, a] of [...byForm].sort()) {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`    ${form.padEnd(11)} n ${String(a.length).padStart(2)}`
    + ` · min ${(Math.min(...a) * 100).toFixed(1)}% · mean ${(mean * 100).toFixed(1)}%`
    + ` · max ${(Math.max(...a) * 100).toFixed(1)}%`);
}
console.log(`\n  sheets: ${sheets.map((s) => s.file).join(' · ')}`);
