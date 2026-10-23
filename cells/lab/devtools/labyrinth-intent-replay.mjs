// Replay a captured blind-intent run against the current build: each gesture of a case, in order, with its recorded
// points and pace, from the case's own starting query. Prints what the build makes now beside what it made when
// captured. Diagnostic only: it reads sealed/, so it's for after a round's reviews are locked, never before.
// node cells/lab/devtools/labyrinth-intent-replay.mjs DIR CASE [--shots=OUTDIR]
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const [root, cs] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const shots = process.argv.find((a) => a.startsWith('--shots='))?.split('=')[1];
if (!root || !cs) throw new Error('Usage: labyrinth-intent-replay.mjs DIR CASE [--shots=OUTDIR]');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ids = J(join(root, 'manifest.json')).ids.filter((id) => id.startsWith(`${cs}-`));
if (!ids.length) throw new Error(`No gestures for ${cs}`);
if (shots) mkdirSync(shots, { recursive: true });
const { withWood } = await import('./harness.mjs');
const brief = (ops) => ops.map((o) => `${o.op.why ?? '?'}${o.op.note ? `: ${o.op.note}` : ''}${o.op.refused ? ` (refused: ${o.op.refused})` : ''}`).join(' + ') || '(nothing)';
await withWood(async (lab) => {
  const first = J(join(root, 'sealed', ids[0], 'replay.json'));
  const p = await lab.open(first.query, { width: 430, height: 900 });
  await p.evaluate(() => { try { localStorage.removeItem('labyrinth.intent'); } catch { /* */ } });
  await p.waitForTimeout(2500);
  const intent = first.before.intent;
  if (intent) { await p.evaluate((i) => window.__labyrinth.setIntent(i), intent); await p.waitForTimeout(300); }
  for (const id of ids) {
    const rp = J(join(root, 'sealed', id, 'replay.json')), was = J(join(root, 'sealed', id, 'result.json'));
    await p.waitForTimeout(1500);
    const ops0 = await p.evaluate(() => window.__labyrinth.world.ops.length);
    if (rp.tap) await p.mouse.click(rp.tap[0], rp.tap[1]);
    else await p.evaluate(({ pts, delays }) => {
      const c = document.getElementById('stone'), busy = (ms) => { const t = performance.now() + ms; while (performance.now() < t) { /* */ } };
      c.setPointerCapture = () => {};
      const ev = (type, [x, y]) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
      ev('pointerdown', pts[0]);
      for (let q = 1; q < pts.length; q++) { busy(delays[q]); ev('pointermove', pts[q]); }
      busy(60); ev('pointerup', pts[pts.length - 1]);
    }, { pts: rp.points, delays: rp.delays });
    await p.waitForTimeout(1200);
    const now = await p.evaluate((ops0) => { const w = window.__labyrinth.world; return w.ops.slice(ops0).map((o) => ({ op: o })); }, ops0);
    console.log(`${id}\n  then: ${brief(was.operations)}\n  now:  ${brief(now)}`);
    if (shots) await p.screenshot({ path: join(shots, `${id}.jpg`), type: 'jpeg', quality: 80 });
  }
  await p.close();
});
