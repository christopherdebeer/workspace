/**
 * ── THE CONTROL SET: EVERY EZ VARIANT, THE SAME FRAMING, WITH ITS CLOSURE ──
 *
 *   node cells/drive/devtools/tree-forms.mjs      (200 m, the honest default)
 *   DIST=100 node .../tree-forms.mjs              (nearer; the cells grow)
 *   INK=1 node .../tree-forms.mjs                 (black silhouettes)
 *   POST=0 node .../tree-forms.mjs                (before the quantiser)
 *
 * THE FRAMING IS A DISTANCE. Every variant renders at the art-pixel size the
 * game would draw it at from `DIST` metres — its own metric height through the
 * chase lens into 320 rendered rows — with NO MSAA, and then through the
 * composite's own 14-level quantise and bayer4 dither. The 224 px cells this
 * tool shipped with were four to ten times the size a tree is ever drawn, on a
 * renderer nobody ships; every judgement taken through them, closure included,
 * was a judgement of a different picture.
 *
 * The seat's ask: a control set across forms and varieties FIRST, then improve
 * dramatically against that baseline. A tree is a judgement, so the baseline is
 * pictures — and a picture with no number beside it cannot say whether the next
 * bake improved anything, so every cell carries CLOSURE: the share of the
 * tree's own bounding box its silhouette fills.
 *
 * CLOSURE IS ONE COLUMN OF FIVE NOW, not the score. It cannot tell a mass from
 * confetti, and at the size a tree is drawn that is the whole difference
 * between one that reads and one that does not. Beside it:
 *
 *   parts    connected components of the silhouette — a tree is ONE thing
 *   big      the share of the silhouette in the largest component
 *   steps    the crown's contrast against the sky it stands on, in PALETTE
 *            STEPS (0.07 sRGB) — under one step it is not there
 *   tones    distinct colours the crown carries after the quantiser
 *   stipple  the share of lit pixels touching at most one neighbour — the
 *            pixels that flicker on and off as the truck moves
 *
 * WHY CLOSURE WAS NOT ENOUGH. The bake already measures `clear`, `width`,
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
const ELEVS = (process.env.ELEV ?? '8').split(',').map(Number);
const DIST = Number(process.env.DIST ?? 200);
const SCALE = Number(process.env.SCALE ?? 2.5);
// PX overrides the distance framing entirely and is the back door for a
// close-up; a sheet taken with it is not a control and the header says so.
const PX = process.env.PX ? Number(process.env.PX) : undefined;
const MAG = Number(process.env.MAG ?? 0);
const COLS = Number(process.env.COLS ?? 6);
const INK = process.env.INK === '1';
const POST = process.env.POST !== '0';
// WHITE is the silhouette test and SKY is the honest one; `dark` is what the
// first sheet used and is kept because a pale crown vanishes on white.
const BG = process.env.BG ?? 'white';
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
console.log(`[${el()}] booting ${FIX}`);
const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1${process.env.QS ? `&${process.env.QS}` : ''}`,
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
  const r = await q((o) => window.__ezsheet(o), {
    dist: DIST, scale: SCALE, px: PX, mag: MAG, cols: COLS, elev, bg: BG, ink: INK, post: POST });
  const file = join(OUT, `tree-forms-${process.env.TAG ?? 'base'}-e${elev}.png`);
  writeFileSync(file, Buffer.from(r.sheet.split(',')[1], 'base64'));
  sheets.push({ elev, file, rows: r.rows, meta: r });
}
await d.close();

const rows = sheets[0].rows;
const meta = sheets[0].meta;
console.log(`\n── the control set · ${rows.length} variants · ${PX ? `${PX}px cells (NOT a control)` : `${DIST} m`}`
  + ` · ${POST ? '14 levels + bayer4' : 'NO post'}${INK ? ' · INK' : ''} · no MSAA`);
console.log(`   design ${meta.design.rows} rows at ${meta.design.fov}° · live ${meta.live.rows} rows at ${meta.live.fov}°`
  + ` · magnified ${meta.mag}x`);
console.log(`  ${'variant'.padEnd(22)}${'form'.padEnd(10)}${'m'.padStart(5)}${'px'.padStart(4)}`
  + `${'tris'.padStart(6)}${'cov'.padStart(7)}${'parts'.padStart(6)}${'big'.padStart(6)}`
  + `${'lum'.padStart(5)}${'sky'.padStart(6)}${'form'.padStart(6)}${'mass'.padStart(6)}${'stip'.padStart(6)}`);
for (const r of rows) {
  console.log(`  ${r.label.padEnd(22)}${r.form.padEnd(10)}${r.heightM.toFixed(0).padStart(5)}`
    + `${String(r.px).padStart(4)}${String(r.tris).padStart(6)}`
    + `${(r.cov * 100).toFixed(1).padStart(6)}%${String(r.parts).padStart(6)}`
    + `${(r.big * 100).toFixed(0).padStart(5)}%${String(r.lum).padStart(5)}${r.steps.toFixed(1).padStart(6)}`
    + `${r.spread.toFixed(1).padStart(6)}${(r.mass * 100).toFixed(0).padStart(5)}%${(r.stipple * 100).toFixed(0).padStart(5)}%`);
}
// ── THE SUMMARY IS BY FORM, because that is the unit a guild asks for ──
// A guild says "conic, columnar"; if every conic variant is illegible then the
// place the guild describes is illegible, whatever the family's mean says.
const byForm = new Map();
for (const r of rows) {
  const a = byForm.get(r.form) ?? [];
  a.push(r); byForm.set(r.form, a);
}
const mean = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;
console.log(`\n  by form, at ${DIST} m`);
console.log(`    ${'form'.padEnd(11)}${'n'.padStart(3)}${'px'.padStart(5)}${'parts'.padStart(7)}`
  + `${'big'.padStart(7)}${'lum'.padStart(6)}${'sky'.padStart(7)}${'form'.padStart(7)}${'mass'.padStart(7)}${'stipple'.padStart(9)}`);
for (const [form, a] of [...byForm].sort()) {
  console.log(`    ${form.padEnd(11)}${String(a.length).padStart(3)}`
    + `${mean(a, (r) => r.px).toFixed(0).padStart(5)}${mean(a, (r) => r.parts).toFixed(1).padStart(7)}`
    + `${(mean(a, (r) => r.big) * 100).toFixed(0).padStart(6)}%${mean(a, (r) => r.lum).toFixed(0).padStart(6)}${mean(a, (r) => r.steps).toFixed(1).padStart(7)}`
    + `${mean(a, (r) => r.spread).toFixed(1).padStart(7)}${(mean(a, (r) => r.mass) * 100).toFixed(0).padStart(6)}%`
    + `${(mean(a, (r) => r.stipple) * 100).toFixed(0).padStart(8)}%`);
}
// ── WHAT A LEGIBLE TREE LOOKS LIKE AS A NUMBER ──
// Stated so a pass can be judged rather than admired: one or two masses, most
// of the silhouette in the largest, at least a palette step and a half of
// contrast against the sky, and under a tenth of the lit pixels alone.
const bad = rows.filter((r) => r.parts > 3 || r.big < 0.7 || r.steps < 1.5
  || r.spread < 1.5 || r.stipple > 0.12);
console.log(`\n  ${rows.length - bad.length}/${rows.length} variants read at ${DIST} m`
  + ` (<=3 parts, >=70% in the largest, >=1.5 steps of sky contrast,`
  + ` >=1.5 steps of its OWN light and dark, <=12% stipple)`);
for (const r of bad) {
  const why = [];
  if (r.parts > 3) why.push(`${r.parts} parts`);
  if (r.big < 0.7) why.push(`${(r.big * 100).toFixed(0)}% largest`);
  if (r.steps < 1.5) why.push(`${r.steps.toFixed(1)} sky`);
  if (r.spread < 1.5) why.push(`${r.spread.toFixed(1)} form`);
  if (r.stipple > 0.12) why.push(`${(r.stipple * 100).toFixed(0)}% stipple`);
  console.log(`    ${r.label.padEnd(24)}${why.join(' · ')}`);
}
console.log(`\n  sheets: ${sheets.map((s) => s.file).join(' · ')}`);
